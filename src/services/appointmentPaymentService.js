import { Appointment } from '../models/Appointment.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { User } from '../models/User.js'
import { createNotification } from './notificationService.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

const HOLD_EXPIRY_MS = 30 * 60 * 1000

/**
 * Shared acquisition: owner-checked scheduled+unpaid appointment with an
 * active lawyer and a healthy profile. ONE appointment_fee txn per
 * appointment via partial-unique index ($setOnInsert pattern).
 */
export async function acquireAppointmentTransaction(user, appointmentId) {
  const appointment = await Appointment.findById(appointmentId)
  if (!appointment || String(appointment.userId) !== String(user.id)) {
    throw fail('Appointment was not found.', 404, 'APPOINTMENT_NOT_FOUND')
  }
  if (appointment.status !== 'scheduled' || appointment.paymentStatus !== 'unpaid') {
    throw fail('This appointment is already closed or paid.', 409, 'APPOINTMENT_ALREADY_CLOSED')
  }

  const profile = await LawyerProfile.findById(appointment.lawyerProfileId)
  const lawyer = await User.findOne({ _id: appointment.lawyerId, role: 'lawyer', status: 'active' })
  if (!profile || !lawyer || ['suspended', 'deleted'].includes(profile.publicationStatus)) {
    throw fail('This consultation payment is unavailable.', 403, 'APPOINTMENT_PAYMENT_UNAVAILABLE')
  }

  let transaction
  try {
    transaction = await PaymentTransaction.findOneAndUpdate(
      { appointmentId: appointment._id, type: 'appointment_fee' },
      {
        $setOnInsert: {
          type: 'appointment_fee',
          payerId: user.id,
          lawyerId: lawyer.id,
          lawyerProfileId: profile.id,
          appointmentId: appointment._id,
          amountMinor: appointment.amountMinor,
          currency: 'usd',
          status: 'pending',
        },
      },
      { returnDocument: 'after', upsert: true },
    )
  } catch (cause) {
    if (cause?.code !== 11000) throw cause
    transaction = await PaymentTransaction.findOne({ appointmentId: appointment._id, type: 'appointment_fee' })
  }

  if (transaction.status === 'paid') throw fail('This appointment has already been paid.', 409, 'APPOINTMENT_ALREADY_PAID')
  if (transaction.status === 'refunded') throw fail('This appointment payment was refunded.', 409, 'APPOINTMENT_ALREADY_CLOSED')
  return { appointment, transaction, lawyer }
}

/**
 * Verified-callback finalizer for appointment fees. Conditional updates make
 * replays exactly-once; commission split mirrors hiring doctrine.
 */
export async function finalizeAppointmentPayment(transaction) {
  const updatedTxn = await PaymentTransaction.findOneAndUpdate(
    { _id: transaction._id, status: 'pending' },
    {
      $set: {
        status: 'paid',
        escrowStatus: 'held',
        platformCommissionMinor: Math.round(transaction.amountMinor * 0.15),
        lawyerPayoutMinor: transaction.amountMinor - Math.round(transaction.amountMinor * 0.15),
      },
      $unset: { checkoutCreating: '' },
    },
    { new: true },
  )

  const updatedAppointment = await Appointment.findOneAndUpdate(
    { _id: transaction.appointmentId, paymentStatus: 'unpaid' },
    { $set: { paymentStatus: 'paid' } },
    { new: true },
  )

  if (!updatedTxn || !updatedAppointment) return { alreadyApplied: true }

  try {
    const [client, lawyer] = await Promise.all([
      User.findById(updatedAppointment.userId).select('_id fullName email'),
      User.findById(updatedAppointment.lawyerId).select('_id fullName email'),
    ])
    if (client) {
      await createNotification({
        userId: client._id,
        title: `Consultation payment confirmed — $${(transaction.amountMinor / 100).toFixed(2)}`,
        message: `Your ${updatedAppointment.dateKey} ${updatedAppointment.start} session is paid. See you there!`,
        type: 'appointment',
        link: '/dashboard',
      })
    }
    if (lawyer) {
      await createNotification({
        userId: lawyer._id,
        title: `Consultation booked & paid — $${(transaction.amountMinor / 100).toFixed(2)}`,
        message: `${client?.fullName ?? 'A client'} paid for ${updatedAppointment.dateKey} ${updatedAppointment.start}.`,
        type: 'appointment',
        link: '/dashboard',
      })
    }
  } catch (cause) {
    void cause
  }

  return { alreadyApplied: false }
}

/** Lazy expiry sweep — silently cancels stale unpaid holds, freeing slots. */
export async function cancelUnpaidAppointmentHolds(filterBase = {}) {
  const cutoff = new Date(Date.now() - HOLD_EXPIRY_MS)
  const due = await Appointment.find({
    ...filterBase,
    status: 'scheduled',
    paymentStatus: 'unpaid',
    createdAt: { $lt: cutoff },
  })
    .select('_id')
    .lean()

  let cancelled = 0
  for (const doc of due) {
    const updated = await Appointment.findOneAndUpdate(
      { _id: doc._id, status: 'scheduled', paymentStatus: 'unpaid' },
      { $set: { status: 'cancelled' } },
      { new: true },
    )
    if (updated) cancelled += 1
  }
  return cancelled
}

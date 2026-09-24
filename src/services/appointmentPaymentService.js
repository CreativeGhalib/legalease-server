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
  const lawyer = profile
    ? await User.findOne({ _id: profile.userId, role: 'lawyer', status: 'active' })
    : null
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

export async function claimAppointmentCheckout(appointment, transaction, gateway) {
  const lockedToStripe = gateway === 'sslcommerz' && transaction.gateway === 'stripe' && transaction.stripeCheckoutSessionId
  const lockedToSslcommerz = gateway === 'stripe' && transaction.gateway === 'sslcommerz' && transaction.gatewayTranId
  if (lockedToStripe || lockedToSslcommerz) {
    throw fail('Continue with the payment gateway already selected for this appointment.', 409, 'PAYMENT_GATEWAY_LOCKED')
  }

  const claimed = await PaymentTransaction.findOneAndUpdate(
    {
      _id: transaction._id,
      status: 'pending',
      checkoutCreating: { $ne: true },
      checkoutAttempt: transaction.checkoutAttempt,
    },
    { $set: { checkoutCreating: true, gateway }, $inc: { checkoutAttempt: 1 } },
    { new: true },
  )
  if (!claimed) throw fail('Checkout is being prepared. Please try again shortly.', 409, 'CHECKOUT_IN_PROGRESS')

  const held = await Appointment.updateOne(
    { _id: appointment._id, status: 'scheduled', paymentStatus: 'unpaid' },
    { $set: { checkoutCreating: true, feeGateway: gateway } },
  )
  if (held.matchedCount === 0) {
    await PaymentTransaction.updateOne(
      { _id: claimed._id, checkoutAttempt: claimed.checkoutAttempt },
      { $set: { checkoutCreating: false } },
    )
    throw fail('This appointment is already closed or paid.', 409, 'APPOINTMENT_ALREADY_CLOSED')
  }
  return claimed
}

export async function releaseAppointmentCheckout(appointmentId, transaction, transactionUpdate = {}) {
  await Promise.all([
    PaymentTransaction.updateOne(
      { _id: transaction._id, checkoutAttempt: transaction.checkoutAttempt },
      { $set: { ...transactionUpdate, checkoutCreating: false } },
    ),
    Appointment.updateOne(
      { _id: appointmentId },
      { $set: { checkoutCreating: false, feeGateway: transaction.gateway } },
    ),
  ])
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
        paidAt: transaction.paidAt ?? new Date(),
        escrowStatus: 'held',
        platformCommissionMinor: Math.round(transaction.amountMinor * 0.15),
        lawyerPayoutMinor: transaction.amountMinor - Math.round(transaction.amountMinor * 0.15),
      },
      $unset: { checkoutCreating: '' },
    },
    { new: true },
  )

  const paidTxn = updatedTxn ?? await PaymentTransaction.findOne({ _id: transaction._id, status: 'paid' })
  if (!paidTxn) return { alreadyApplied: true }

  const updatedAppointment = await Appointment.findOneAndUpdate(
    { _id: transaction.appointmentId, status: 'scheduled', paymentStatus: 'unpaid' },
    { $set: { paymentStatus: 'paid', checkoutCreating: false, feeGateway: paidTxn.gateway } },
    { new: true },
  )

  if (!updatedAppointment) return { alreadyApplied: !updatedTxn }

  try {
    const [client, lawyer] = await Promise.all([
      User.findById(updatedAppointment.userId).select('_id fullName email'),
      User.findById(paidTxn.lawyerId).select('_id fullName email'),
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
    checkoutCreating: { $ne: true },  // M-3: skip slots mid-checkout
    createdAt: { $lt: cutoff },
  })
    .select('_id')
    .lean()

  let cancelled = 0
  for (const doc of due) {
    const pendingCheckout = await PaymentTransaction.exists({
      appointmentId: doc._id,
      type: 'appointment_fee',
      status: 'pending',
      $or: [
        { stripeCheckoutSessionId: { $exists: true, $ne: null } },
        { gatewayTranId: { $exists: true, $ne: null } },
      ],
    })
    if (pendingCheckout) continue

    const updated = await Appointment.findOneAndUpdate(
      { _id: doc._id, status: 'scheduled', paymentStatus: 'unpaid', checkoutCreating: { $ne: true } },
      { $set: { status: 'cancelled' } },
      { new: true },
    )
    if (updated) cancelled += 1
  }
  return cancelled
}

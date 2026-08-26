import mongoose from 'mongoose'
import { Dispute } from '../models/Dispute.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { User } from '../models/User.js'
import { createNotification } from './notificationService.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

const DISPUTE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export async function openDispute(user, { hiringRequestId, reason }) {
  if (!isValidId(hiringRequestId)) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')

  const engagement = await HiringRequest.findById(hiringRequestId)
  const isClient = String(engagement?.clientId) === String(user.id)
  const isLawyer = String(engagement?.lawyerId) === String(user.id)
  if (!engagement || (!isClient && !isLawyer)) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')

  if (engagement.paymentStatus !== 'paid' || !engagement.paidAt) {
    throw fail('Disputes apply to paid engagements only.', 403, 'DISPUTE_NOT_ELIGIBLE')
  }
  if (Date.now() - engagement.paidAt.getTime() > DISPUTE_WINDOW_MS) {
    throw fail('The 30-day dispute window for this engagement has closed.', 403, 'DISPUTE_WINDOW_CLOSED')
  }

  const transaction = await PaymentTransaction.findOne({ hiringRequestId: engagement._id, type: 'hiring_fee' })
  if (!transaction || transaction.status !== 'paid') {
    throw fail('No verifiable payment exists for this engagement.', 404, 'CASE_NOT_FOUND')
  }

  let dispute
  try {
    dispute = await Dispute.create({
      hiringRequestId: engagement._id,
      openedById: user.id,
      openedByRole: user.role === 'lawyer' ? 'lawyer' : 'user',
      reason,
    })
  } catch (error) {
    if (error?.code === 11000) throw fail('A dispute is already open for this case.', 409, 'DISPUTE_ALREADY_OPEN')
    throw error
  }

  await PaymentTransaction.updateOne(
    { _id: transaction._id, escrowStatus: 'held' },
    { $set: { escrowStatus: 'disputed' } },
  )
  await HiringRequest.updateOne({ _id: engagement._id }, { $set: { disputeStatus: 'opened' } })

  const counterpartId = isClient ? engagement.lawyerId : engagement.clientId
  await createNotification({
    userId: counterpartId,
    title: `Dispute opened on ${engagement.specializationSnapshot} case`,
    message: `${user.fullName} raised a dispute. Payment actions are paused while an admin reviews.`,
    type: 'system',
    link: '/dashboard',
  })
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').limit(10)
  for (const admin of admins) {
    await createNotification({
      userId: admin._id,
      title: `New dispute — ${engagement.specializationSnapshot}`,
      message: `${user.fullName} disputed a $${(transaction.amountMinor / 100).toFixed(2)} payment. Admin resolution required.`,
      type: 'system',
      link: '/dashboard/admin/disputes',
    })
  }

  return dispute
}

async function notifyParties(engagement, title, message) {
  const parties = await User.find({ _id: { $in: [engagement.clientId, engagement.lawyerId] } }).select('_id')
  for (const party of parties) {
    await createNotification({ userId: party._id, title, message, type: 'payment', link: '/dashboard' })
  }
}

export async function resolveDispute(admin, disputeId, { outcome, note }) {
  if (!isValidId(disputeId)) throw fail('Dispute was not found.', 404, 'DISPUTE_NOT_FOUND')

  const dispute = await Dispute.findById(disputeId)
  if (!dispute) throw fail('Dispute was not found.', 404, 'DISPUTE_NOT_FOUND')
  if (dispute.status !== 'open') throw fail('This dispute is already resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')

  const engagement = await HiringRequest.findById(dispute.hiringRequestId)
  const transaction = await PaymentTransaction.findOne({ hiringRequestId: dispute.hiringRequestId, type: 'hiring_fee', status: 'paid' })
  if (!engagement || !transaction) throw fail('Linked case or payment was not found.', 404, 'CASE_NOT_FOUND')

  const now = new Date()
  if (outcome === 'refund') {
    const updated = await PaymentTransaction.findOneAndUpdate(
      { _id: transaction._id, status: 'paid' },
      {
        $set: {
          status: 'refunded',
          escrowStatus: 'refunded',
          refundAmountMinor: transaction.amountMinor,
        },
      },
      { new: true },
    )
    if (!updated) throw fail('This dispute is already resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')
    await notifyParties(engagement, `Dispute resolved — refund issued`, `Admin refunded $${(transaction.amountMinor / 100).toFixed(2)} for the ${engagement.specializationSnapshot} engagement. Note: ${note}`)
  } else {
    const updated = await PaymentTransaction.findOneAndUpdate(
      { _id: transaction._id, escrowStatus: { $in: ['held', 'disputed'] } },
      {
        $set: {
          escrowStatus: 'released',
          releaseReason: 'admin',
          releasedAt: now,
        },
      },
      { new: true },
    )
    if (!updated) throw fail('This dispute is already resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')
    await notifyParties(engagement, 'Dispute resolved — funds released', `Admin reviewed the ${engagement.specializationSnapshot} dispute and released the funds to the lawyer. Note: ${note}`)
  }

  const closed = await Dispute.findOneAndUpdate(
    { _id: dispute._id, status: 'open' },
    {
      $set: {
        status: outcome === 'refund' ? 'resolved_refund' : 'resolved_release',
        resolvedById: admin.id,
        resolutionNote: note,
      },
    },
    { new: true },
  )
  if (!closed) throw fail('This dispute is already resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')

  await HiringRequest.updateOne({ _id: engagement._id }, { $set: { disputeStatus: 'resolved' } })
  return closed
}

export async function adminRefundTransaction(admin, txnId, note) {
  if (!isValidId(txnId)) throw fail('Transaction was not found.', 404, 'PAYMENT_NOT_FOUND')

  const transaction = await PaymentTransaction.findOne({ _id: txnId, type: 'hiring_fee', status: 'paid', escrowStatus: { $in: ['held', 'disputed'] } })
  if (!transaction) throw fail('No refundable held escrow found for this transaction.', 409, 'ESCROW_NOT_REFUNDABLE')

  const updated = await PaymentTransaction.findOneAndUpdate(
    { _id: transaction._id, status: 'paid', escrowStatus: { $in: ['held', 'disputed'] } },
    {
      $set: {
        status: 'refunded',
        escrowStatus: 'refunded',
        refundAmountMinor: transaction.amountMinor,
      },
    },
    { new: true },
  )
  if (!updated) throw fail('This dispute is already resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')

  if (transaction.hiringRequestId) {
    await Dispute.updateMany(
      { hiringRequestId: transaction.hiringRequestId, status: 'open' },
      { $set: { status: 'resolved_refund', resolvedById: admin.id, resolutionNote: note } },
    )
    await HiringRequest.updateOne({ _id: transaction.hiringRequestId }, { $set: { disputeStatus: 'resolved' } })

    const engagement = await HiringRequest.findById(transaction.hiringRequestId)
    if (engagement) {
      await notifyParties(engagement, 'Payment refunded by admin', `An administrator refunded the $${(transaction.amountMinor / 100).toFixed(2)} payment for the ${engagement.specializationSnapshot} engagement. Note: ${note}`)
    }
  }
  return updated
}

export async function forceReleaseEscrow(admin, txnId, note) {
  if (!isValidId(txnId)) throw fail('Transaction was not found.', 404, 'PAYMENT_NOT_FOUND')

  const updated = await PaymentTransaction.findOneAndUpdate(
    { _id: txnId, status: 'paid', escrowStatus: { $in: ['held', 'disputed'] }, type: 'hiring_fee' },
    { $set: { escrowStatus: 'released', releaseReason: 'admin', releasedAt: new Date() } },
    { new: true },
  )
  if (!updated) throw fail('No releasable held escrow found for this transaction.', 409, 'ESCROW_NOT_RELEASABLE')

  if (updated.hiringRequestId) {
    const open = await Dispute.findOneAndUpdate(
      { hiringRequestId: updated.hiringRequestId, status: 'open' },
      { $set: { status: 'resolved_release', resolvedById: admin.id, resolutionNote: note } },
      { new: true },
    )
    if (open) await HiringRequest.updateOne({ _id: open.hiringRequestId }, { $set: { disputeStatus: 'resolved' } })

    const engagement = await HiringRequest.findById(updated.hiringRequestId)
    if (engagement) {
      await notifyParties(engagement, 'Escrow released by admin', `An administrator released the $${(updated.amountMinor / 100).toFixed(2)} escrow for the ${engagement.specializationSnapshot} engagement. Note: ${note}`)
    }
  }
  return updated
}

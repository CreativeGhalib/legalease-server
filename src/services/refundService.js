import crypto from 'node:crypto'
import Stripe from 'stripe'
import { env } from '../config/env.js'
import { Dispute } from '../models/Dispute.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { User } from '../models/User.js'
import { AUDIT_ACTIONS, logAudit } from './auditService.js'
import { createNotification } from './notificationService.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function sslcommerzRefundUrl() {
  return env.SSCOMMERZ_SANDBOX !== false
    ? 'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php'
    : 'https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php'
}

async function sslcommerzRequest(params) {
  if (!env.SSCOMMERZ_STORE_ID || !env.SSCOMMERZ_STORE_PASSWORD) {
    throw fail('SSLCommerz refunds are not configured.', 503, 'REFUNDS_UNAVAILABLE')
  }
  params.set('store_id', env.SSCOMMERZ_STORE_ID)
  params.set('store_passwd', env.SSCOMMERZ_STORE_PASSWORD)
  params.set('format', 'json')
  try {
    const response = await fetch(`${sslcommerzRefundUrl()}?${params.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result || result.APIConnect !== 'DONE') {
      throw fail('SSLCommerz could not process the refund request.', 502, 'REFUND_GATEWAY_FAILED')
    }
    return result
  } catch (error) {
    if (error.statusCode) throw error
    throw fail('SSLCommerz could not be reached for the refund request.', 502, 'REFUND_GATEWAY_UNAVAILABLE')
  }
}

async function requestStripeRefund(transaction, note) {
  if (!env.STRIPE_SECRET_KEY || !transaction.stripePaymentIntentId) {
    throw fail('This Stripe payment cannot be refunded automatically.', 409, 'REFUND_REFERENCE_MISSING')
  }
  const stripe = new Stripe(env.STRIPE_SECRET_KEY)
  let refund
  try {
    refund = transaction.gatewayRefundId
      ? await stripe.refunds.retrieve(transaction.gatewayRefundId)
      : await stripe.refunds.create({
          payment_intent: transaction.stripePaymentIntentId,
          amount: transaction.amountMinor,
          reason: 'requested_by_customer',
          metadata: {
            transactionId: transaction.id,
            note: note.slice(0, 450),
          },
        }, { idempotencyKey: `legalease-refund-${transaction.id}` })
  } catch {
    throw fail('Stripe could not process the refund request.', 502, 'REFUND_GATEWAY_FAILED')
  }
  return {
    id: refund.id,
    status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending',
    failureReason: refund.failure_reason ?? '',
  }
}

async function requestSslcommerzRefund(transaction, note) {
  if (transaction.gatewayRefundId) {
    const status = await sslcommerzRequest(new URLSearchParams({ refund_ref_id: transaction.gatewayRefundId }))
    return {
      id: transaction.gatewayRefundId,
      status: status.status === 'refunded' ? 'succeeded' : status.status === 'cancelled' ? 'failed' : 'pending',
      failureReason: status.errorReason ?? '',
    }
  }
  if (!transaction.gatewayBankTranId) {
    throw fail('This SSLCommerz payment is missing its bank transaction reference.', 409, 'REFUND_REFERENCE_MISSING')
  }
  if (!transaction.gatewayAmountMinor || transaction.gatewayCurrency !== 'bdt') {
    throw fail('This SSLCommerz payment is missing its original gateway amount.', 409, 'REFUND_AMOUNT_MISSING')
  }
  const refundTransactionId = `LER${String(transaction._id)}`.slice(0, 30)
  const result = await sslcommerzRequest(new URLSearchParams({
    bank_tran_id: transaction.gatewayBankTranId,
    refund_trans_id: refundTransactionId,
    refund_amount: (transaction.gatewayAmountMinor / 100).toFixed(2),
    refund_remarks: note.slice(0, 255),
    refe_id: String(transaction._id),
    v: '1',
  }))
  if (!['success', 'processing'].includes(result.status) || !result.refund_ref_id) {
    return { id: result.refund_ref_id ?? '', status: 'failed', failureReason: result.errorReason ?? 'Refund initiation failed.' }
  }
  return { id: result.refund_ref_id, status: 'pending', failureReason: '' }
}

async function notifyRefund(transaction, engagement) {
  const parties = await User.find({ _id: { $in: [engagement.clientId, engagement.lawyerId] } }).select('_id')
  for (const party of parties) {
    await createNotification({
      userId: party._id,
      title: 'Payment refund confirmed',
      message: `The $${(transaction.amountMinor / 100).toFixed(2)} refund for the ${engagement.specializationSnapshot} engagement was confirmed by ${transaction.gateway === 'stripe' ? 'Stripe' : 'SSLCommerz'}.`,
      type: 'payment',
      link: '/dashboard',
    })
  }
}

async function finalizeConfirmedRefund(transaction, admin, note, gatewayRefundId) {
  const actorId = admin?.id ?? transaction.refundRequestedById ?? null
  const resolutionNote = note || transaction.refundNote || 'Refund confirmed by payment provider.'
  const updated = await PaymentTransaction.findOneAndUpdate(
    { _id: transaction._id, status: 'paid', refundStatus: 'pending' },
    {
      $set: {
        status: 'refunded',
        escrowStatus: 'refunded',
        refundStatus: 'succeeded',
        refundAmountMinor: transaction.amountMinor,
        gatewayRefundId,
        refundedAt: new Date(),
        refundFailureReason: '',
      },
    },
    { new: true },
  )
  if (!updated) return PaymentTransaction.findById(transaction._id)

  const engagement = await HiringRequest.findById(transaction.hiringRequestId)
  if (engagement) {
    await Dispute.updateMany(
      { hiringRequestId: engagement._id, status: 'open' },
      { $set: { status: 'resolved_refund', resolvedById: actorId, resolutionNote } },
    )
    await HiringRequest.updateOne({ _id: engagement._id }, { $set: { disputeStatus: 'resolved' } })
    await notifyRefund(updated, engagement)
  }
  await logAudit({
    actorId,
    actorRole: 'admin',
    action: AUDIT_ACTIONS.PAYMENT_REFUND,
    targetType: 'PaymentTransaction',
    targetId: String(updated._id),
    meta: { gateway: updated.gateway, gatewayRefundId, note: resolutionNote },
  })
  return updated
}

export async function refundHiringTransaction(admin, transaction, note) {
  if (!transaction || transaction.type !== 'hiring_fee' || transaction.status !== 'paid' || !['held', 'disputed'].includes(transaction.escrowStatus)) {
    throw fail('No refundable held payment was found.', 409, 'ESCROW_NOT_REFUNDABLE')
  }

  const claimed = transaction.refundStatus === 'pending'
    ? transaction
    : await PaymentTransaction.findOneAndUpdate(
        { _id: transaction._id, status: 'paid', refundStatus: { $in: [null, 'failed'] } },
        {
          $set: {
            refundStatus: 'pending',
            refundRequestedAt: new Date(),
            refundRequestedById: admin.id,
            refundNote: note,
            refundFailureReason: '',
            escrowStatus: 'disputed',
          },
        },
        { new: true },
      )
  if (!claimed) throw fail('A refund is already being processed for this payment.', 409, 'REFUND_IN_PROGRESS')

  let gatewayResult
  try {
    gatewayResult = claimed.gateway === 'sslcommerz'
      ? await requestSslcommerzRefund(claimed, note)
      : await requestStripeRefund(claimed, note)
  } catch (error) {
    await PaymentTransaction.updateOne(
      { _id: claimed._id, status: 'paid' },
      { $set: { refundStatus: 'failed', refundFailureReason: String(error.message).slice(0, 500) } },
    )
    throw error
  }

  if (gatewayResult.status === 'failed') {
    await PaymentTransaction.updateOne(
      { _id: claimed._id, status: 'paid' },
      { $set: { refundStatus: 'failed', gatewayRefundId: gatewayResult.id || undefined, refundFailureReason: gatewayResult.failureReason.slice(0, 500) } },
    )
    throw fail('The payment provider rejected the refund.', 502, 'REFUND_GATEWAY_FAILED')
  }

  await PaymentTransaction.updateOne(
    { _id: claimed._id, status: 'paid' },
    { $set: { refundStatus: 'pending', gatewayRefundId: gatewayResult.id, escrowStatus: 'disputed' } },
  )
  if (gatewayResult.status === 'succeeded') {
    const pending = await PaymentTransaction.findById(claimed._id)
    return { transaction: await finalizeConfirmedRefund(pending, admin, note, gatewayResult.id), pending: false }
  }
  return { transaction: await PaymentTransaction.findById(claimed._id), pending: true }
}

export async function reconcileStripeRefund(refund) {
  const transactionId = refund.metadata?.transactionId
  if (!transactionId) return
  const transaction = await PaymentTransaction.findById(transactionId)
  const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id
  if (!transaction || transaction.gateway !== 'stripe' || transaction.stripePaymentIntentId !== paymentIntentId) return
  if (refund.status === 'succeeded') {
    await finalizeConfirmedRefund(transaction, null, transaction.refundNote, refund.id)
  } else if (refund.status === 'failed' || refund.status === 'canceled') {
    await PaymentTransaction.updateOne(
      { _id: transaction._id, status: 'paid' },
      { $set: { refundStatus: 'failed', gatewayRefundId: refund.id, refundFailureReason: refund.failure_reason ?? '' } },
    )
  } else {
    await PaymentTransaction.updateOne(
      { _id: transaction._id, status: 'paid' },
      { $set: { refundStatus: 'pending', gatewayRefundId: refund.id } },
    )
  }
}

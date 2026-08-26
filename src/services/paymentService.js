import Stripe from 'stripe'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { User } from '../models/User.js'
import { sendPaymentConfirmationEmail } from './emailService.js'

function error(message, statusCode, code) { return Object.assign(new Error(message), { statusCode, code }) }
export function isProfileComplete(profile) { return Boolean(profile.professionalPhotoUrl && profile.specialization && profile.bio && profile.consultationFeeMinor > 0 && Number.isInteger(profile.experienceYears) && profile.experienceYears >= 0 && profile.licenseNumber) }
function stripeClient() { if (!env.STRIPE_SECRET_KEY || !env.LAWYER_PUBLISHING_FEE_CENTS) throw error('Payments are not configured yet.', 503, 'PAYMENTS_UNAVAILABLE'); return new Stripe(env.STRIPE_SECRET_KEY) }
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function createVerificationCheckout(user, { stripe: injectedStripe } = {}) {
  const profile = await LawyerProfile.findOne({ userId: user.id })
  if (!profile) throw error('Create your professional profile before verification.', 404, 'LAWYER_PROFILE_NOT_FOUND')
  if (profile.publicationStatus === 'suspended' || profile.publicationStatus === 'deleted') throw error('This profile cannot start verification.', 403, 'PROFILE_NOT_ELIGIBLE')
  if (!isProfileComplete(profile)) throw error('Complete your professional profile before verification.', 400, 'PROFILE_INCOMPLETE')
  if (profile.verificationStatus === 'paid') throw error('Your profile has already been verified.', 409, 'VERIFICATION_ALREADY_PAID')
  let transaction
  try {
    transaction = await PaymentTransaction.findOneAndUpdate(
      { lawyerProfileId: profile.id, type: 'lawyer_verification' },
      { $setOnInsert: { payerId: user.id, lawyerId: user.id, lawyerProfileId: profile.id, type: 'lawyer_verification', amountMinor: env.LAWYER_PUBLISHING_FEE_CENTS, currency: env.STRIPE_CURRENCY, status: 'pending' } },
      { returnDocument: 'after', upsert: true },
    )
  } catch (cause) {
    if (cause?.code !== 11000) throw cause
    transaction = await PaymentTransaction.findOne({ lawyerProfileId: profile.id, type: 'lawyer_verification' })
  }
  if (transaction.status === 'paid') throw error('Your profile has already been verified.', 409, 'VERIFICATION_ALREADY_PAID')
  const stripe = injectedStripe ?? stripeClient()
  for (let retry = 0; retry < 10; retry += 1) {
    transaction = await PaymentTransaction.findById(transaction.id)
    if (transaction.status === 'paid') throw error('Your profile has already been verified.', 409, 'VERIFICATION_ALREADY_PAID')
    if (transaction.checkoutCreating) { await pause(100); continue }
    if (transaction.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(transaction.stripeCheckoutSessionId)
      if (existing.status === 'open' && existing.url) return { transaction, checkoutUrl: existing.url }
    }
    const claimed = await PaymentTransaction.findOneAndUpdate(
      { _id: transaction.id, status: 'pending', checkoutCreating: { $ne: true }, checkoutAttempt: transaction.checkoutAttempt },
      { $set: { checkoutCreating: true }, $inc: { checkoutAttempt: 1 } },
      { returnDocument: 'after' },
    )
    if (!claimed) { await pause(100); continue }
    try {
      const baseUrl = env.clientOrigins[0]
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', payment_method_types: ['card'],
        line_items: [{ price_data: { currency: claimed.currency, product_data: { name: 'LegalEase lawyer publishing verification' }, unit_amount: claimed.amountMinor }, quantity: 1 }],
        metadata: { transactionId: claimed.id, lawyerProfileId: profile.id, lawyerId: user.id, type: 'lawyer_verification' },
        success_url: `${baseUrl}/payment/success?transactionId=${claimed.id}`,
        cancel_url: `${baseUrl}/payment/cancel?transactionId=${claimed.id}`,
      }, { idempotencyKey: `legalease-verification-${claimed.id}-${claimed.checkoutAttempt}` })
      const saved = await PaymentTransaction.findOneAndUpdate(
        { _id: claimed.id, checkoutCreating: true, checkoutAttempt: claimed.checkoutAttempt },
        { $set: { stripeCheckoutSessionId: session.id, checkoutCreating: false } },
        { returnDocument: 'after' },
      )
      if (!saved) throw error('Checkout preparation could not be completed. Please try again.', 409, 'CHECKOUT_RETRY_REQUIRED')
      await LawyerProfile.updateOne({ _id: profile.id, verificationStatus: { $ne: 'paid' } }, { $set: { verificationStatus: 'checkout_created' } })
      return { transaction: saved, checkoutUrl: session.url }
    } catch (cause) {
      await PaymentTransaction.updateOne({ _id: claimed.id, status: { $ne: 'paid' }, checkoutCreating: true }, { $set: { checkoutCreating: false } })
      throw cause
    }
  }
  throw error('Verification checkout is being prepared. Please try again shortly.', 409, 'CHECKOUT_IN_PROGRESS')
}

export async function fulfillVerificationSession(session) {
  if (session.payment_status !== 'paid') return
  const transactionId = session.metadata?.transactionId
  if (!transactionId || session.metadata?.type !== 'lawyer_verification') throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const transaction = await PaymentTransaction.findById(transactionId)
  if (!transaction || transaction.type !== 'lawyer_verification' || transaction.stripeCheckoutSessionId !== session.id || String(transaction.lawyerProfileId) !== session.metadata.lawyerProfileId || transaction.amountMinor !== session.amount_total || transaction.currency !== session.currency) throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const profile = await LawyerProfile.findById(transaction.lawyerProfileId)
  if (!profile) throw error('Payment profile is unavailable.', 404, 'LAWYER_PROFILE_NOT_FOUND')
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const paidAt = transaction.paidAt ?? new Date()
  await PaymentTransaction.updateOne(
    { _id: transaction.id, status: { $ne: 'paid' } },
    { $set: { status: 'paid', paidAt, stripePaymentIntentId: paymentIntentId, checkoutCreating: false } },
  )
  const paidTransaction = await PaymentTransaction.findById(transaction.id)
  await LawyerProfile.updateOne(
    { _id: profile.id, verificationStatus: { $ne: 'paid' } },
    { $set: { verificationStatus: 'paid', verificationPaidAt: paidTransaction.paidAt } },
  )
  const verifyingLawyer = await User.findById(transaction.payerId).select('fullName email')
  if (verifyingLawyer) {
    await sendPaymentConfirmationEmail(verifyingLawyer, verifyingLawyer, transaction.amountMinor, transaction.currency)
  }
}

export async function createHiringCheckout(user, requestId, { stripe: injectedStripe } = {}) {
  if (!mongoose.isObjectIdOrHexString(requestId)) throw error('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
  const request = await HiringRequest.findOne({ _id: requestId, clientId: user.id, status: 'accepted' })
  if (!request) throw error('This hiring request cannot be paid.', 404, 'HIRING_PAYMENT_NOT_ALLOWED')
  if (request.paymentStatus === 'paid') throw error('This hiring request has already been paid.', 409, 'HIRING_PAYMENT_ALREADY_PAID')
  const profile = await LawyerProfile.findById(request.lawyerProfileId)
  const lawyer = await User.findOne({ _id: request.lawyerId, role: 'lawyer', status: 'active' })
  if (!profile || !lawyer || ['suspended', 'deleted'].includes(profile.publicationStatus)) throw error('This hiring payment is unavailable.', 403, 'HIRING_PAYMENT_UNAVAILABLE')
  let transaction
  try { transaction = await PaymentTransaction.findOneAndUpdate({ hiringRequestId: request.id, type: 'hiring_fee' }, { $setOnInsert: { type: 'hiring_fee', payerId: user.id, lawyerId: request.lawyerId, lawyerProfileId: request.lawyerProfileId, hiringRequestId: request.id, amountMinor: request.feeMinorSnapshot, currency: request.currency.toLowerCase(), status: 'pending' } }, { returnDocument: 'after', upsert: true }) } catch (cause) { if (cause?.code !== 11000) throw cause; transaction = await PaymentTransaction.findOne({ hiringRequestId: request.id, type: 'hiring_fee' }) }
  if (transaction.status === 'paid') throw error('This hiring request has already been paid.', 409, 'HIRING_PAYMENT_ALREADY_PAID')
  const stripe = injectedStripe ?? stripeClient()
  for (let retry = 0; retry < 10; retry += 1) {
    transaction = await PaymentTransaction.findById(transaction.id)
    if (transaction.checkoutCreating) { await pause(100); continue }
    if (transaction.stripeCheckoutSessionId) { const existing = await stripe.checkout.sessions.retrieve(transaction.stripeCheckoutSessionId); if (existing.status === 'open' && existing.url) return { transaction, checkoutUrl: existing.url } }
    const claimed = await PaymentTransaction.findOneAndUpdate({ _id: transaction.id, status: 'pending', checkoutCreating: { $ne: true }, checkoutAttempt: transaction.checkoutAttempt }, { $set: { checkoutCreating: true }, $inc: { checkoutAttempt: 1 } }, { returnDocument: 'after' })
    if (!claimed) { await pause(100); continue }
    try {
      const baseUrl = env.clientOrigins[0]; const session = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], line_items: [{ price_data: { currency: claimed.currency, product_data: { name: 'LegalEase hiring fee' }, unit_amount: claimed.amountMinor }, quantity: 1 }], metadata: { transactionId: claimed.id, hiringRequestId: request.id, lawyerId: String(request.lawyerId), lawyerProfileId: String(request.lawyerProfileId), type: 'hiring_fee' }, success_url: `${baseUrl}/payment/success?transactionId=${claimed.id}`, cancel_url: `${baseUrl}/payment/cancel?transactionId=${claimed.id}` }, { idempotencyKey: `legalease-hiring-${claimed.id}-${claimed.checkoutAttempt}` })
      const saved = await PaymentTransaction.findOneAndUpdate({ _id: claimed.id, checkoutCreating: true, checkoutAttempt: claimed.checkoutAttempt }, { $set: { stripeCheckoutSessionId: session.id, checkoutCreating: false } }, { returnDocument: 'after' }); if (!saved) throw error('Checkout retry required.', 409, 'CHECKOUT_RETRY_REQUIRED')
      await HiringRequest.updateOne({ _id: request.id, paymentStatus: { $ne: 'paid' } }, { $set: { paymentStatus: 'checkout_created' } }); return { transaction: saved, checkoutUrl: session.url }
    } catch (cause) { await PaymentTransaction.updateOne({ _id: claimed.id, status: { $ne: 'paid' } }, { $set: { checkoutCreating: false } }); throw cause }
  }
  throw error('Checkout is being prepared. Please try again.', 409, 'CHECKOUT_IN_PROGRESS')
}

export async function fulfillHiringSession(session) {
  if (session.payment_status !== 'paid' || session.metadata?.type !== 'hiring_fee') return
  const transaction = await PaymentTransaction.findById(session.metadata.transactionId)
  if (!transaction || transaction.type !== 'hiring_fee' || transaction.stripeCheckoutSessionId !== session.id || String(transaction.hiringRequestId) !== session.metadata.hiringRequestId || transaction.amountMinor !== session.amount_total || transaction.currency !== session.currency) throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const request = await HiringRequest.findById(transaction.hiringRequestId)
  if (!request || request.status !== 'accepted' || String(request.clientId) !== String(transaction.payerId) || String(request.lawyerId) !== String(transaction.lawyerId) || String(request.lawyerProfileId) !== String(transaction.lawyerProfileId) || String(request.id) !== session.metadata.hiringRequestId || String(request.lawyerId) !== session.metadata.lawyerId || String(request.lawyerProfileId) !== session.metadata.lawyerProfileId || request.feeMinorSnapshot !== transaction.amountMinor || request.currency.toLowerCase() !== transaction.currency) throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const paidAt = transaction.paidAt ?? new Date(); const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  await PaymentTransaction.updateOne({ _id: transaction.id, status: { $ne: 'paid' } }, { $set: { status: 'paid', paidAt, stripePaymentIntentId: intent, checkoutCreating: false } })
  await HiringRequest.findOneAndUpdate({ _id: request.id, status: 'accepted', paymentStatus: { $ne: 'paid' } }, { $set: { paymentStatus: 'paid', paidAt } }, { returnDocument: 'after' })
  const paidHireCount = await HiringRequest.countDocuments({ lawyerProfileId: request.lawyerProfileId, status: 'accepted', paymentStatus: 'paid' })
  await LawyerProfile.updateOne({ _id: request.lawyerProfileId }, { $max: { paidHireCount } })
  const [hiringClient, hiringLawyer] = await Promise.all([
    User.findById(request.clientId).select('fullName email'),
    User.findById(request.lawyerId).select('fullName email'),
  ])
  if (hiringClient && hiringLawyer) {
    await sendPaymentConfirmationEmail(hiringClient, hiringLawyer, request.feeMinorSnapshot, request.currency)
  }
}

// Webhooks are the normal fulfillment path. This server-side reconciliation is
// deliberately narrow: it can only inspect the already-stored Stripe session
// for an existing, owner-authorized transaction. It never trusts browser data.
export async function reconcilePendingPayment(transaction) {
  if (!transaction || transaction.status === 'paid' || !transaction.stripeCheckoutSessionId) return transaction
  const stripe = stripeClient()
  const session = await stripe.checkout.sessions.retrieve(transaction.stripeCheckoutSessionId)
  if (session.payment_status !== 'paid') return transaction
  if (transaction.type === 'hiring_fee') await fulfillHiringSession(session)
  if (transaction.type === 'lawyer_verification') await fulfillVerificationSession(session)
  return PaymentTransaction.findById(transaction.id)
}

export async function resetExpiredCheckout(session) {
  const transactionId = session.metadata?.transactionId
  if (!transactionId) return
  const transaction = await PaymentTransaction.findById(transactionId)
  if (!transaction || transaction.status === 'paid' || transaction.stripeCheckoutSessionId !== session.id) return
  if (transaction.type === 'lawyer_verification') await LawyerProfile.updateOne({ _id: transaction.lawyerProfileId, verificationStatus: 'checkout_created' }, { $set: { verificationStatus: 'unpaid' } })
  if (transaction.type === 'hiring_fee') await HiringRequest.updateOne({ _id: transaction.hiringRequestId, paymentStatus: 'checkout_created' }, { $set: { paymentStatus: 'unpaid' } })
}

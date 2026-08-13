import Stripe from 'stripe'
import { env } from '../config/env.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'

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
        line_items: [{ price_data: { currency: env.STRIPE_CURRENCY, product_data: { name: 'LegalEase lawyer publishing verification' }, unit_amount: env.LAWYER_PUBLISHING_FEE_CENTS }, quantity: 1 }],
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
}

export async function resetExpiredCheckout(session) {
  const transactionId = session.metadata?.transactionId
  if (!transactionId) return
  const transaction = await PaymentTransaction.findById(transactionId)
  if (!transaction || transaction.status === 'paid' || transaction.stripeCheckoutSessionId !== session.id) return
  await LawyerProfile.updateOne({ _id: transaction.lawyerProfileId, verificationStatus: 'checkout_created' }, { $set: { verificationStatus: 'unpaid' } })
}

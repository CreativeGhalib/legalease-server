import Stripe from 'stripe'
import { env } from '../config/env.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'

function error(message, statusCode, code) { return Object.assign(new Error(message), { statusCode, code }) }
export function isProfileComplete(profile) { return Boolean(profile.professionalPhotoUrl && profile.specialization && profile.bio && profile.consultationFeeMinor > 0 && Number.isInteger(profile.experienceYears) && profile.experienceYears >= 0 && profile.licenseNumber) }
function stripeClient() { if (!env.STRIPE_SECRET_KEY) throw error('Payments are not configured yet.', 503, 'PAYMENTS_UNAVAILABLE'); return new Stripe(env.STRIPE_SECRET_KEY) }

export async function createVerificationCheckout(user) {
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
      { new: true, upsert: true },
    )
  } catch (cause) {
    if (cause?.code !== 11000) throw cause
    transaction = await PaymentTransaction.findOne({ lawyerProfileId: profile.id, type: 'lawyer_verification' })
  }
  if (transaction.status === 'paid') throw error('Your profile has already been verified.', 409, 'VERIFICATION_ALREADY_PAID')
  const stripe = stripeClient()
  if (transaction.stripeCheckoutSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(transaction.stripeCheckoutSessionId)
    if (existing.status === 'open' && existing.url) return { transaction, checkoutUrl: existing.url }
  }
  const baseUrl = env.CLIENT_ORIGINS.split(',')[0]
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'],
    line_items: [{ price_data: { currency: env.STRIPE_CURRENCY, product_data: { name: 'LegalEase lawyer publishing verification' }, unit_amount: env.LAWYER_PUBLISHING_FEE_CENTS }, quantity: 1 }],
    metadata: { transactionId: transaction.id, lawyerProfileId: profile.id, lawyerId: user.id, type: 'lawyer_verification' },
    success_url: `${baseUrl}/payment/success?transactionId=${transaction.id}`,
    cancel_url: `${baseUrl}/payment/cancel?transactionId=${transaction.id}`,
  }, { idempotencyKey: `legalease-verification-${transaction.id}` })
  transaction.stripeCheckoutSessionId = session.id
  await transaction.save()
  if (profile.verificationStatus !== 'paid') { profile.verificationStatus = 'checkout_created'; await profile.save() }
  return { transaction, checkoutUrl: session.url }
}

export async function fulfillVerificationSession(session) {
  if (session.payment_status !== 'paid') return
  const transactionId = session.metadata?.transactionId
  if (!transactionId || session.metadata?.type !== 'lawyer_verification') throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const transaction = await PaymentTransaction.findById(transactionId)
  if (!transaction || transaction.type !== 'lawyer_verification' || transaction.stripeCheckoutSessionId !== session.id || String(transaction.lawyerProfileId) !== session.metadata.lawyerProfileId || transaction.amountMinor !== session.amount_total || transaction.currency !== session.currency) throw error('Payment session cannot be reconciled.', 400, 'INVALID_PAYMENT_SESSION')
  const profile = await LawyerProfile.findById(transaction.lawyerProfileId)
  if (!profile) throw error('Payment profile is unavailable.', 404, 'LAWYER_PROFILE_NOT_FOUND')
  if (transaction.status !== 'paid') { transaction.status = 'paid'; transaction.paidAt ??= new Date(); transaction.stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id; await transaction.save() }
  if (profile.verificationStatus !== 'paid') { profile.verificationStatus = 'paid'; profile.verificationPaidAt ??= transaction.paidAt; await profile.save() }
}

export async function resetExpiredCheckout(session) {
  const transactionId = session.metadata?.transactionId
  if (!transactionId) return
  const transaction = await PaymentTransaction.findById(transactionId)
  if (!transaction || transaction.status === 'paid' || transaction.stripeCheckoutSessionId !== session.id) return
  await LawyerProfile.updateOne({ _id: transaction.lawyerProfileId, verificationStatus: 'checkout_created' }, { $set: { verificationStatus: 'unpaid' } })
}

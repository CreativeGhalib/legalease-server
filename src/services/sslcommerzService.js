import crypto from 'node:crypto'
import { env } from '../config/env.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { User } from '../models/User.js'
import { finalizeVerifiedHiringPayment } from './paymentService.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isConfigured() {
  return Boolean(env.SSCOMMERZ_STORE_ID && env.SSCOMMERZ_STORE_PASSWORD)
}

function baseUrl() {
  const sandbox = env.SSCOMMERZ_SANDBOX !== false
  return sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com'
}

function clientBase() {
  return env.clientOrigins[0]
}

async function acquireHiringTransaction(user, requestId) {
  if (!requestId || requestId.length < 12) throw fail('This hiring request cannot be paid.', 404, 'HIRING_PAYMENT_NOT_ALLOWED')

  const hiringRequest = await HiringRequest.findOne({ _id: requestId, clientId: user.id, status: 'accepted' })
  if (!hiringRequest) throw fail('This hiring request cannot be paid.', 404, 'HIRING_PAYMENT_NOT_ALLOWED')
  if (hiringRequest.paymentStatus === 'paid') throw fail('This hiring request has already been paid.', 409, 'HIRING_PAYMENT_ALREADY_PAID')

  const profile = await LawyerProfile.findById(hiringRequest.lawyerProfileId)
  const lawyer = await User.findOne({ _id: hiringRequest.lawyerId, role: 'lawyer', status: 'active' })
  if (!profile || !lawyer || ['suspended', 'deleted'].includes(profile.publicationStatus)) {
    throw fail('This hiring payment is unavailable.', 403, 'HIRING_PAYMENT_UNAVAILABLE')
  }

  let transaction
  try {
    transaction = await PaymentTransaction.findOneAndUpdate(
      { hiringRequestId: hiringRequest.id, type: 'hiring_fee' },
      {
        $setOnInsert: {
          type: 'hiring_fee',
          payerId: user.id,
          lawyerId: hiringRequest.lawyerId,
          lawyerProfileId: hiringRequest.lawyerProfileId,
          hiringRequestId: hiringRequest.id,
          amountMinor: hiringRequest.feeMinorSnapshot,
          currency: hiringRequest.currency.toLowerCase(),
          status: 'pending',
        },
      },
      { returnDocument: 'after', upsert: true },
    )
  } catch (cause) {
    if (cause?.code !== 11000) throw cause
    transaction = await PaymentTransaction.findOne({ hiringRequestId: hiringRequest.id, type: 'hiring_fee' })
  }

  if (transaction.status === 'paid') throw fail('This hiring request has already been paid.', 409, 'HIRING_PAYMENT_ALREADY_PAID')
  if (transaction.gateway === 'stripe' && transaction.stripeCheckoutSessionId) {
    throw fail('Continue with your original Stripe checkout for this engagement.', 409, 'PAYMENT_GATEWAY_LOCKED')
  }
  return { hiringRequest, transaction }
}

export async function initiateSslcommerzHiringCheckout(user, requestId) {
  if (!isConfigured()) throw fail('Local payments are not configured yet.', 503, 'SSLCOMMERZ_UNAVAILABLE')

  const { hiringRequest, transaction } = await acquireHiringTransaction(user, requestId)

  const tranId = `LE-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
  const payload = new URLSearchParams({
    store_id: env.SSCOMMERZ_STORE_ID,
    store_passwd: env.SSCOMMERZ_STORE_PASSWORD,
    total_amount: (hiringRequest.feeMinorSnapshot / 100).toFixed(2),
    currency: 'BDT',
    tran_id: tranId,
    success_url: `${clientBase()}/payment/sslcommerz/success?txn=${transaction.id}`,
    fail_url: `${clientBase()}/payment/sslcommerz/fail?txn=${transaction.id}`,
    cancel_url: `${clientBase()}/payment/sslcommerz/cancel?txn=${transaction.id}`,
    ipn_url: `${clientBase()}/api/payments/sslcommerz/ipn`,
    cus_name: payerName(user),
    cus_email: user.email,
    cus_add1: 'Dhaka',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: 'N/A',
    shipping_method: 'NO',
    num_of_item: 1,
    product_name: `LegalEase consultation fee — ${hiringRequest.specializationSnapshot}`,
    product_category: 'Legal Services',
    product_profile: 'non-physical-goods',
  })

  let gatewayResponse
  try {
    const apiResponse = await fetch(`${baseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
      signal: AbortSignal.timeout(20_000),
    })
    gatewayResponse = await apiResponse.json().catch(() => null)
  } catch (cause) {
    throw fail('The local payment gateway could not be reached. Please try again shortly.', 502, 'GATEWAY_UNAVAILABLE')
  }

  if (!gatewayResponse?.GatewayPageURL) {
    throw fail('The local payment gateway rejected this session. Please try again shortly.', 502, 'GATEWAY_SESSION_FAILED')
  }

  await PaymentTransaction.updateOne(
    { _id: transaction.id, status: { $ne: 'paid' } },
    { $set: { gateway: 'sslcommerz', gatewayTranId: tranId } },
  )

  return { transactionId: transaction.id, redirectUrl: gatewayResponse.GatewayPageURL }
}

function payerName(user) {
  return user.fullName || 'LegalEase client'
}

export async function validateIpnWithGateway({ val_id }) {
  const params = new URLSearchParams({
    val_id,
    store_id: env.SSCOMMERZ_STORE_ID,
    store_passwd: env.SSCOMMERZ_STORE_PASSWORD,
    format: 'json',
  })
  const apiResponse = await fetch(`${baseUrl()}/validator/api/validationserverAPI.php?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  })
  return apiResponse.json().catch(() => null)
}

export async function handleSslcommerzIpn(ipnPayload) {
  if (!isConfigured()) throw fail('Local payments are not configured yet.', 503, 'SSLCOMMERZ_UNAVAILABLE')

  const { tran_id: tranId, val_id: valId, amount, currency } = ipnPayload
  if (!tranId || !valId || !amount) throw fail('IPN payload is incomplete.', 400, 'INVALID_IPN')

  const validation = await validateIpnWithGateway({ val_id: valId })
  if (!validation || !['VALID', 'Validated'].includes(validation.status)) {
    throw fail('Payment validation with the gateway failed.', 400, 'INVALID_IPN')
  }

  const transaction = await PaymentTransaction.findOne({ gatewayTranId: tranId })
  if (!transaction || transaction.type !== 'hiring_fee' || transaction.gateway !== 'sslcommerz') {
    throw fail('IPN does not match a pending LegalEase payment.', 400, 'INVALID_IPN')
  }

  const expectedAmount = (transaction.amountMinor / 100).toFixed(2)
  if (Number(amount) !== Number(expectedAmount) || String(currency).toUpperCase() !== 'BDT') {
    throw fail('IPN amount does not match the stored obligation.', 400, 'INVALID_IPN')
  }

  if (validation.tran_id && validation.tran_id !== tranId) {
    throw fail('IPN does not match the stored obligation.', 400, 'INVALID_IPN')
  }

  if (transaction.status === 'paid') return { alreadyPaid: true }

  const hiringRequest = await HiringRequest.findById(transaction.hiringRequestId)
  if (!hiringRequest || hiringRequest.paymentStatus === 'paid') {
    throw fail('IPN does not match the stored obligation.', 400, 'INVALID_IPN')
  }

  await finalizeVerifiedHiringPayment({
    transaction,
    request: hiringRequest,
    gatewayValId: valId,
    withCommission: true,
  })

  return { fulfilled: true, transactionId: String(transaction._id) }
}

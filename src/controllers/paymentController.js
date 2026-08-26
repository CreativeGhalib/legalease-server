import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { User } from '../models/User.js'
import {
  createHiringCheckout,
  createVerificationCheckout,
  fulfillHiringSession,
  fulfillVerificationSession,
  isProfileComplete,
  reconcilePendingPayment,
  resetExpiredCheckout,
} from '../services/paymentService.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

// ─── Verification Checkout ────────────────────────────────────────────────────

export async function startVerificationCheckout(request, response, next) {
  try {
    const { transaction, checkoutUrl } = await createVerificationCheckout(request.auth.user)
    return response.status(201).json({
      success: true,
      data: { transactionId: transaction.id, checkoutUrl },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── Hiring Checkout ──────────────────────────────────────────────────────────

export async function startHiringCheckout(request, response, next) {
  try {
    const { transaction, checkoutUrl } = await createHiringCheckout(
      request.auth.user,
      request.params.requestId,
    )
    return response.status(201).json({
      success: true,
      data: { transactionId: transaction.id, checkoutUrl },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── Payment Status ───────────────────────────────────────────────────────────

export async function getPaymentStatus(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) {
      throw fail('Payment was not found.', 404, 'PAYMENT_NOT_FOUND')
    }

    let transaction = await PaymentTransaction.findOne({
      _id: request.params.id,
      payerId: request.auth.user.id,
    })
    if (!transaction) throw fail('Payment was not found.', 404, 'PAYMENT_NOT_FOUND')

    // Attempt server-side reconciliation for pending sessions
    transaction = await reconcilePendingPayment(transaction)

    // Fetch profile — only strictly needed for verification type,
    // but also validates the transaction record is internally consistent.
    const profile = await LawyerProfile.findById(transaction.lawyerProfileId)
    if (!profile) throw fail('Payment was not found.', 404, 'PAYMENT_NOT_FOUND')

    // Hiring-specific data — only queried when the transaction is a hiring fee
    let hiringRequest = null
    if (transaction.type === 'hiring_fee') {
      hiringRequest = await HiringRequest.findById(transaction.hiringRequestId).select(
        'status paymentStatus paidAt',
      )
      if (!hiringRequest) throw fail('Payment was not found.', 404, 'PAYMENT_NOT_FOUND')
    }

    const isVerification = transaction.type === 'lawyer_verification'

    return response.json({
      success: true,
      data: {
        transactionId: transaction.id,
        type: transaction.type,
        transactionStatus: transaction.status,
        paidAt: transaction.paidAt,
        // Verification-only fields
        verificationStatus: isVerification ? profile.verificationStatus : undefined,
        publicationStatus: isVerification ? profile.publicationStatus : undefined,
        canPublish: isVerification
          ? transaction.status === 'paid' &&
            isProfileComplete(profile) &&
            !['suspended', 'deleted'].includes(profile.publicationStatus)
          : undefined,
        // Hiring-only fields
        hiringRequestStatus: hiringRequest?.status,
        hiringPaymentStatus: hiringRequest?.paymentStatus,
        hiringPaidAt: hiringRequest?.paidAt,
      },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── My Payments ─────────────────────────────────────────────────────────────

export async function listMyPayments(request, response, next) {
  try {
    // Users see payments they made; lawyers see payments connected to their profile
    const filter =
      request.auth.user.role === 'user'
        ? { payerId: request.auth.user.id }
        : { lawyerId: request.auth.user.id }

    const items = await PaymentTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .select('type amountMinor currency status paidAt createdAt hiringRequestId payerId lawyerId')
      .lean()

    const partyIds = [...new Set(items.flatMap((item) => [String(item.payerId), String(item.lawyerId)]))]
    const parties = partyIds.length
      ? await User.find({ _id: { $in: partyIds } }).select('fullName').lean()
      : []
    const nameById = new Map(parties.map((party) => [String(party._id), party.fullName]))

    const engagementIds = items.map((item) => item.hiringRequestId).filter(Boolean)
    const engagements = engagementIds.length
      ? await HiringRequest.find({ _id: { $in: engagementIds } }).select('specializationSnapshot').lean()
      : []
    const specializationByEngagement = new Map(engagements.map((doc) => [String(doc._id), doc.specializationSnapshot]))

    return response.json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: String(item._id),
          type: item.type,
          amountMinor: item.amountMinor,
          currency: item.currency,
          status: item.status,
          paidAt: item.paidAt,
          createdAt: item.createdAt,
          hiringRequestId: item.hiringRequestId ? String(item.hiringRequestId) : null,
          payerName: nameById.get(String(item.payerId)) ?? null,
          lawyerName: nameById.get(String(item.lawyerId)) ?? null,
          engagementSpecialization:
            item.hiringRequestId ? specializationByEngagement.get(String(item.hiringRequestId)) ?? null : null,
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

export async function stripeWebhook(request, response, next) {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
      throw fail('Webhook is not configured.', 503, 'WEBHOOK_UNAVAILABLE')
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(env.STRIPE_SECRET_KEY)

    const event = stripe.webhooks.constructEvent(
      request.body,
      request.headers['stripe-signature'],
      env.STRIPE_WEBHOOK_SECRET,
    )

    if (event.type === 'checkout.session.completed') {
      if (event.data.object.metadata?.type === 'hiring_fee') {
        await fulfillHiringSession(event.data.object)
      } else {
        await fulfillVerificationSession(event.data.object)
      }
    }

    if (event.type === 'checkout.session.expired') {
      await resetExpiredCheckout(event.data.object)
    }

    return response.json({ received: true })
  } catch (error) {
    if (error.type === 'StripeSignatureVerificationError') {
      return response.status(400).json({
        success: false,
        error: {
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: 'Webhook signature verification failed.',
        },
      })
    }
    return next(error)
  }
}

// ─── Publication (Lawyer self-serve) ─────────────────────────────────────────

export async function updatePublication(request, response, next) {
  try {
    const profile = await LawyerProfile.findOne({ userId: request.auth.user.id })
    if (!profile) {
      throw fail('Professional profile was not found.', 404, 'LAWYER_PROFILE_NOT_FOUND')
    }

    if (
      profile.publicationStatus === 'suspended' ||
      profile.publicationStatus === 'deleted'
    ) {
      throw fail('This publication state cannot be changed.', 403, 'PUBLICATION_LOCKED')
    }

    const { publicationStatus } = request.body

    if (publicationStatus === 'published') {
      if (profile.verificationStatus !== 'paid') {
        throw fail('Verified payment is required before publishing.', 403, 'VERIFICATION_REQUIRED')
      }
      if (!isProfileComplete(profile)) {
        throw fail('Complete your profile before publishing.', 400, 'PROFILE_INCOMPLETE')
      }
      profile.publicationStatus = 'published'
    } else if (profile.publicationStatus === 'published') {
      profile.publicationStatus = 'unpublished'
    } else {
      throw fail(
        'Only a published profile can be unpublished.',
        409,
        'INVALID_PUBLICATION_TRANSITION',
      )
    }

    await profile.save()
    return response.json({ success: true, data: { publicationStatus: profile.publicationStatus } })
  } catch (error) {
    return next(error)
  }
}

import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
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
  releaseEscrowDueFor,
  resetExpiredCheckout,
} from '../services/paymentService.js'
import { handleSslcommerzIpn, initiateSslcommerzHiringCheckout } from '../services/sslcommerzService.js'
import { resolveEngagementFor } from './caseTrackerController.js'
import { createNotification } from '../services/notificationService.js'

const COMPLETION_CONFIRM_GRACE_MS = 24 * 60 * 60 * 1000

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

// ─── SSLCommerz (bKash / Nagad / local cards) ─────────────────────────────────

export async function startSslcommerzHiringCheckout(request, response, next) {
  try {
    const result = await initiateSslcommerzHiringCheckout(request.auth.user, request.params.requestId)
    return response.status(201).json({ success: true, data: result })
  } catch (error) {
    return next(error)
  }
}

export async function sslcommerzIpn(request, response, next) {
  try {
    const result = await handleSslcommerzIpn(request.body ?? {})
    return response.status(200).json({ received: true, ...result })
  } catch (error) {
    if (['INVALID_IPN'].includes(error.code)) {
      logger.warn('SSLCommerz IPN rejected.', { error: error.message })
      return response.status(400).json({ success: false, error: { code: 'INVALID_IPN', message: error.message } })
    }
    return next(error)
  }
}

// ─── Escrow Release ───────────────────────────────────────────────────────────

export async function confirmCaseCompletion(request, response, next) {
  try {
    const { engagement } = await resolveEngagementFor(request.auth.user, request.params.hiringRequestId)

    const transaction = await PaymentTransaction.findOne({
      hiringRequestId: engagement._id,
      type: 'hiring_fee',
    })
    if (!transaction || transaction.status !== 'paid') {
      throw fail('Payment for this case was not found.', 404, 'CASE_NOT_FOUND')
    }

    if (transaction.escrowStatus === 'released') {
      return response.json({
        success: true,
        data: {
          escrowStatus: transaction.escrowStatus,
          releaseReason: transaction.releaseReason,
          releasedAt: transaction.releasedAt,
        },
      })
    }

    if (transaction.paidAt && Date.now() - transaction.paidAt.getTime() < COMPLETION_CONFIRM_GRACE_MS) {
      throw fail('Funds can be released 24 hours after payment.', 409, 'CONFIRM_TOO_EARLY')
    }

    const updated = await PaymentTransaction.findOneAndUpdate(
      { _id: transaction._id, escrowStatus: 'held' },
      {
        $set: {
          escrowStatus: 'released',
          releaseReason: 'client_confirmed',
          releasedAt: new Date(),
        },
      },
      { new: true },
    )
    if (!updated) throw fail('Escrow state changed, please refresh and try again.', 409, 'ESCROW_STATE_CHANGED')

    const lawyer = await User.findById(engagement.lawyerId).select('_id fullName')
    if (lawyer) {
      await createNotification({
        userId: lawyer._id,
        title: `Funds released for ${engagement.specializationSnapshot} engagement`,
        message: `${request.auth.user.fullName} confirmed completion — $${(updated.amountMinor / 100).toFixed(2)} marked released.`,
        type: 'payment',
        link: '/dashboard/lawyer/hiring-history',
      })
    }

    return response.json({
      success: true,
      data: {
        escrowStatus: updated.escrowStatus,
        releaseReason: updated.releaseReason,
        releasedAt: updated.releasedAt,
      },
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
        gateway: transaction.gateway ?? 'stripe',
        escrowStatus: transaction.escrowStatus ?? null,
        releaseReason: transaction.releaseReason ?? null,
        releasedAt: transaction.releasedAt ?? null,
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

    // Lazy auto-release sweep scoped to the caller's slice of the ledger.
    await releaseEscrowDueFor(filter)

    const items = await PaymentTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .select('type amountMinor currency status paidAt createdAt hiringRequestId payerId lawyerId escrowStatus releaseReason releasedAt')
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
          escrowStatus: item.escrowStatus ?? null,
          releaseReason: item.releaseReason ?? null,
          releasedAt: item.releasedAt ?? null,
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

import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { PaymentTransaction } from '../models/PaymentTransaction.js'
import { isProfileComplete } from '../services/paymentService.js'
import { sendProfilePublishedEmail } from '../services/emailService.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

/**
 * Safe public DTO for a user record exposed to admin endpoints.
 * providers/googleSub are intentionally excluded — not needed in the admin UI.
 */
function safeUser(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    profileImageUrl: user.profileImageUrl || '',
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  }
}

async function requireUser(id) {
  if (!isValidId(id)) throw fail('User was not found.', 404, 'USER_NOT_FOUND')
  const user = await User.findById(id)
  if (!user) throw fail('User was not found.', 404, 'USER_NOT_FOUND')
  return user
}

/**
 * Guard: prevent the last active admin from being demoted or deactivated.
 * Only runs when the target user IS an active admin AND the proposed change
 * would remove admin access (role downgrade) or block admin access (deactivation).
 */
async function protectLastAdmin(user, changes) {
  const isActiveAdmin = user.role === 'admin' && user.status === 'active'
  if (!isActiveAdmin) return

  const wouldLoseAdminRole = changes.role !== undefined && changes.role !== 'admin'
  const wouldBeDeactivated = changes.status !== undefined && changes.status === 'deactivated'

  if (!wouldLoseAdminRole && !wouldBeDeactivated) return

  const activeAdminCount = await User.countDocuments({ role: 'admin', status: 'active' })
  if (activeAdminCount <= 1) {
    throw fail('The final active admin cannot be changed.', 409, 'FINAL_ADMIN_PROTECTED')
  }
}

const PAGE_SIZE = 10

// ─── Users ──────────────────────────────────────────────────────────────────

export async function listUsers(req, res, next) {
  try {
    const q = req.validatedQuery
    const filter = {}

    if (q.role) filter.role = q.role
    if (q.status) filter.status = q.status
    if (q.search) {
      const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [
        { fullName: new RegExp(escaped, 'i') },
        { email: new RegExp(escaped, 'i') },
      ]
    }

    const skip = (q.page - 1) * PAGE_SIZE
    const [items, totalItems] = await Promise.all([
      User.find(filter)
        .select('fullName email profileImageUrl role status createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(PAGE_SIZE),
      User.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: { items: items.map(safeUser) },
      meta: {
        page: q.page,
        pageSize: PAGE_SIZE,
        totalItems,
        totalPages: Math.ceil(totalItems / PAGE_SIZE),
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function updateRole(req, res, next) {
  try {
    const user = await requireUser(req.params.id)
    await protectLastAdmin(user, { role: req.body.role })

    // If a lawyer is demoted, remove their public listing
    if (user.role === 'lawyer' && req.body.role !== 'lawyer') {
      await LawyerProfile.updateOne(
        { userId: user._id, publicationStatus: 'published' },
        { $set: { publicationStatus: 'unpublished' } },
      )
    }

    user.role = req.body.role
    await user.save()

    res.json({ success: true, data: { user: safeUser(user) } })
  } catch (error) {
    next(error)
  }
}

export async function updateStatus(req, res, next) {
  try {
    const user = await requireUser(req.params.id)
    await protectLastAdmin(user, { status: req.body.status })

    if (req.body.status === 'deactivated') {
      user.tokenVersion = (user.tokenVersion || 0) + 1
    }
    user.status = req.body.status
    await user.save()

    res.json({ success: true, data: { user: safeUser(user) } })
  } catch (error) {
    next(error)
  }
}

// ─── Lawyers ─────────────────────────────────────────────────────────────────

export async function listLawyers(req, res, next) {
  try {
    const q = req.validatedQuery
    const filter = {}

    if (q.publicationStatus) filter.publicationStatus = q.publicationStatus
    if (q.verificationStatus) filter.verificationStatus = q.verificationStatus

    const skip = (q.page - 1) * PAGE_SIZE
    const [items, totalItems] = await Promise.all([
      LawyerProfile.find(filter)
        .populate('userId', 'fullName email status role')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(PAGE_SIZE),
      LawyerProfile.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: {
        items: items.map((profile) => ({
          id: String(profile._id),
          fullName: profile.userId?.fullName || 'Unavailable',
          email: profile.userId?.email || '',
          accountStatus: profile.userId?.status || 'deactivated',
          professionalPhotoUrl: profile.professionalPhotoUrl,
          specialization: profile.specialization,
          consultationFeeMinor: profile.consultationFeeMinor,
          availability: profile.availability,
          verificationStatus: profile.verificationStatus,
          publicationStatus: profile.publicationStatus,
          paidHireCount: profile.paidHireCount,
          createdAt: profile.createdAt,
        })),
      },
      meta: {
        page: q.page,
        pageSize: PAGE_SIZE,
        totalItems,
        totalPages: Math.ceil(totalItems / PAGE_SIZE),
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function moderateLawyer(req, res, next) {
  try {
    if (!isValidId(req.params.id)) {
      throw fail('Lawyer profile was not found.', 404, 'LAWYER_PROFILE_NOT_FOUND')
    }

    const profile = await LawyerProfile.findById(req.params.id).populate('userId', 'fullName email role status')
    if (!profile?.userId) {
      throw fail('Lawyer profile was not found.', 404, 'LAWYER_PROFILE_NOT_FOUND')
    }

    const { action } = req.body

    if (action === 'restore') {
      if (profile.publicationStatus !== 'deleted') {
        throw fail('Only deleted profiles can be restored.', 409, 'INVALID_PUBLICATION_TRANSITION')
      }
      // Restore to unpublished if eligible, otherwise draft
      profile.publicationStatus =
        profile.verificationStatus === 'paid' && isProfileComplete(profile)
          ? 'unpublished'
          : 'draft'
      profile.deletedAt = null
      profile.deletedByRole = null
    } else {
      if (profile.publicationStatus === 'deleted') {
        throw fail(
          'Restore this deleted profile before changing its publication state.',
          409,
          'PROFILE_DELETED',
        )
      }

      if (action === 'publish') {
        const eligible =
          profile.userId.role === 'lawyer' &&
          profile.userId.status === 'active' &&
          profile.verificationStatus === 'paid' &&
          isProfileComplete(profile)

        if (!eligible) {
          throw fail('This profile is not eligible for publishing.', 409, 'PROFILE_NOT_ELIGIBLE')
        }
        profile.publicationStatus = 'published'
      } else if (action === 'unpublish') {
        profile.publicationStatus = 'unpublished'
      } else if (action === 'suspend') {
        profile.publicationStatus = 'suspended'
      }
    }

    await profile.save()
    if (action === 'publish' && profile.userId?.email) {
      await sendProfilePublishedEmail(profile.userId)
    }
    res.json({ success: true, data: { publicationStatus: profile.publicationStatus } })
  } catch (error) {
    next(error)
  }
}

export async function deleteLawyer(req, res, next) {
  try {
    if (!isValidId(req.params.id)) {
      throw fail('Lawyer profile was not found.', 404, 'LAWYER_PROFILE_NOT_FOUND')
    }

    const profile = await LawyerProfile.findById(req.params.id)
    if (!profile) {
      throw fail('Lawyer profile was not found.', 404, 'LAWYER_PROFILE_NOT_FOUND')
    }

    profile.publicationStatus = 'deleted'
    profile.deletedAt = new Date()
    profile.deletedByRole = 'admin'
    await profile.save()

    res.status(204).end()
  } catch (error) {
    next(error)
  }
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function listTransactions(req, res, next) {
  try {
    const q = req.validatedQuery
    const filter = {}

    if (q.type) filter.type = q.type
    if (q.status) filter.status = q.status

    const skip = (q.page - 1) * PAGE_SIZE
    const [items, totalItems] = await Promise.all([
      PaymentTransaction.find(filter)
        .populate('payerId', 'fullName email')
        .populate('lawyerId', 'fullName email')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(PAGE_SIZE),
      PaymentTransaction.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: {
        items: items.map((transaction) => ({
          id: String(transaction._id),
          type: transaction.type,
          payer: transaction.payerId
            ? { fullName: transaction.payerId.fullName, email: transaction.payerId.email }
            : null,
          lawyer: transaction.lawyerId
            ? { fullName: transaction.lawyerId.fullName, email: transaction.lawyerId.email }
            : null,
          amountMinor: transaction.amountMinor,
          currency: transaction.currency,
          status: transaction.status,
          createdAt: transaction.createdAt,
          paidAt: transaction.paidAt,
        })),
      },
      meta: {
        page: q.page,
        pageSize: PAGE_SIZE,
        totalItems,
        totalPages: Math.ceil(totalItems / PAGE_SIZE),
      },
    })
  } catch (error) {
    next(error)
  }
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function analytics(_req, res, next) {
  try {
    const [
      users,
      lawyers,
      paidHires,
      revenueResult,
      monthlyRevenueResult,
      monthlyHiresResult,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'lawyer' }),
      HiringRequest.countDocuments({ paymentStatus: 'paid' }),
      PaymentTransaction.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, amountMinor: { $sum: '$amountMinor' } } },
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: 'paid', paidAt: { $ne: null } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
            revenueMinor: { $sum: '$amountMinor' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      HiringRequest.aggregate([
        { $match: { paymentStatus: 'paid', paidAt: { $ne: null } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
            paidHires: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ])

    res.json({
      success: true,
      data: {
        users,
        lawyers,
        paidHires,
        revenueMinor: revenueResult[0]?.amountMinor || 0,
        monthlyRevenue: monthlyRevenueResult.map((entry) => ({
          month: entry._id,
          revenueMinor: entry.revenueMinor,
        })),
        monthlyHires: monthlyHiresResult.map((entry) => ({
          month: entry._id,
          paidHires: entry.paidHires,
        })),
      },
    })
  } catch (error) {
    next(error)
  }
}

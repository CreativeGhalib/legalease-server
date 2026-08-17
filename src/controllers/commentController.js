import mongoose from 'mongoose'
import { Comment } from '../models/Comment.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { LawyerProfile } from '../models/LawyerProfile.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

function unavailable() {
  return buildError('This lawyer profile is not publicly available.', 404, 'LAWYER_NOT_FOUND')
}

/**
 * Safe public DTO for a single comment.
 * Handles the case where authorId was not populated (e.g. user account deleted).
 */
function safeComment(comment) {
  return {
    id: comment._id.toString(),
    content: comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      fullName: comment.authorId?.fullName ?? 'Unknown',
      profileImageUrl: comment.authorId?.profileImageUrl || '',
    },
  }
}

/**
 * Resolves and validates a published, eligible lawyer profile for public routes.
 * Throws a public-safe 404 for any ineligible or missing profile.
 */
async function resolvePublicProfile(profileId) {
  if (!isValidId(profileId)) throw unavailable()

  const profile = await LawyerProfile.findOne({
    _id: profileId,
    publicationStatus: 'published',
    verificationStatus: 'paid',
  }).populate({
    path: 'userId',
    match: { role: 'lawyer', status: 'active' },
    select: 'fullName',
  })

  if (!profile?.userId) throw unavailable()
  return profile
}

// ─── Public comment listing ───────────────────────────────────────────────────

export async function listPublicComments(request, response, next) {
  try {
    await resolvePublicProfile(request.params.profileId)

    const comments = await Comment.find({ lawyerProfileId: request.params.profileId })
      .populate('authorId', 'fullName profileImageUrl')
      .sort({ createdAt: -1, _id: -1 })

    return response.json({
      success: true,
      data: { items: comments.map(safeComment) },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── Create comment ───────────────────────────────────────────────────────────

export async function createComment(request, response, next) {
  try {
    if (!isValidId(request.params.profileId)) {
      throw buildError('Lawyer profile was not found.', 404, 'LAWYER_NOT_FOUND')
    }

    const profile = await LawyerProfile.findOne({
      _id: request.params.profileId,
      publicationStatus: { $ne: 'deleted' },
    })
    if (!profile) {
      throw buildError('Lawyer profile was not found.', 404, 'LAWYER_NOT_FOUND')
    }

    // Gate: must have an accepted, paid hire with this lawyer
    const hiring = await HiringRequest.findOne({
      clientId: request.auth.user._id,
      lawyerId: profile.userId,
      lawyerProfileId: profile._id,
      status: 'accepted',
      paymentStatus: 'paid',
    })
    if (!hiring) {
      throw buildError(
        'Only clients with an accepted, paid hire can comment.',
        403,
        'COMMENT_NOT_ELIGIBLE',
      )
    }

    try {
      const comment = await Comment.create({
        authorId: request.auth.user._id,
        lawyerId: profile.userId,
        lawyerProfileId: profile._id,
        hiringRequestId: hiring._id,
        content: request.body.content,
      })
      await comment.populate('authorId', 'fullName profileImageUrl')

      return response.status(201).json({
        success: true,
        data: { comment: safeComment(comment) },
      })
    } catch (dbError) {
      if (dbError?.code === 11000) {
        throw buildError('You already have a comment for this lawyer.', 409, 'COMMENT_ALREADY_EXISTS')
      }
      throw dbError
    }
  } catch (error) {
    return next(error)
  }
}

// ─── My comments (authenticated user) ────────────────────────────────────────

export async function listMine(request, response, next) {
  try {
    const comments = await Comment.find({ authorId: request.auth.user._id })
      .populate({
        path: 'lawyerProfileId',
        select: 'professionalPhotoUrl specialization publicationStatus',
        populate: { path: 'userId', select: 'fullName' },
      })
      .sort({ createdAt: -1, _id: -1 })

    const items = comments.map((comment) => ({
      id: comment._id.toString(),
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      lawyerProfileId: comment.lawyerProfileId?._id?.toString() || null,
      lawyer: comment.lawyerProfileId
        ? {
            fullName: comment.lawyerProfileId.userId?.fullName || 'Lawyer profile unavailable',
            professionalPhotoUrl: comment.lawyerProfileId.professionalPhotoUrl || '',
            specialization: comment.lawyerProfileId.specialization || '',
            publiclyAvailable: comment.lawyerProfileId.publicationStatus === 'published',
          }
        : null,
    }))

    return response.json({ success: true, data: { items } })
  } catch (error) {
    return next(error)
  }
}

// ─── Resolve owned comment (edit / delete) ────────────────────────────────────

async function requireOwnComment(id, userId) {
  if (!isValidId(id)) throw buildError('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
  const comment = await Comment.findOne({ _id: id, authorId: userId })
  if (!comment) throw buildError('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
  return comment
}

// ─── Update comment ───────────────────────────────────────────────────────────

export async function updateComment(request, response, next) {
  try {
    const comment = await requireOwnComment(request.params.id, request.auth.user._id)
    comment.content = request.body.content
    await comment.save()
    await comment.populate('authorId', 'fullName profileImageUrl')

    return response.json({
      success: true,
      data: { comment: safeComment(comment) },
    })
  } catch (error) {
    return next(error)
  }
}

// ─── Delete comment ───────────────────────────────────────────────────────────

export async function deleteComment(request, response, next) {
  try {
    if (!isValidId(request.params.id)) {
      throw buildError('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
    }

    // Admins can delete any comment; users can only delete their own
    const comment =
      request.auth.user.role === 'admin'
        ? await Comment.findById(request.params.id)
        : await Comment.findOne({ _id: request.params.id, authorId: request.auth.user._id })

    if (!comment) throw buildError('Comment was not found.', 404, 'COMMENT_NOT_FOUND')

    await comment.deleteOne()
    return response.status(204).end()
  } catch (error) {
    return next(error)
  }
}

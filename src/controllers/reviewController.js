import mongoose from 'mongoose'
import { Review } from '../models/Review.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { LawyerProfile } from '../models/LawyerProfile.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

async function recalculateProfileRating(lawyerProfileId) {
  const [aggregate] = await Review.aggregate([
    { $match: { lawyerProfileId: new mongoose.Types.ObjectId(String(lawyerProfileId)) } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ])
  const averageRating = aggregate ? Math.round(aggregate.average * 10) / 10 : 0
  await LawyerProfile.updateOne(
    { _id: lawyerProfileId },
    { $set: { averageRating, reviewCount: aggregate?.count ?? 0 } },
  )
}

export async function createReview(request, response, next) {
  try {
    if (!isValidId(request.body.hiringRequestId)) {
      throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
    }

    const hiring = await HiringRequest.findOne({ _id: request.body.hiringRequestId, clientId: request.auth.user.id })
    if (!hiring) throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
    if (hiring.paymentStatus !== 'paid') {
      throw fail('Only paid engagements can be reviewed.', 403, 'REVIEW_NOT_ELIGIBLE')
    }

    try {
      const review = await Review.create({
        userId: request.auth.user.id,
        lawyerId: hiring.lawyerId,
        lawyerProfileId: hiring.lawyerProfileId,
        hiringRequestId: hiring.id,
        rating: request.body.rating,
        feedback: request.body.feedback ?? '',
      })
      await recalculateProfileRating(hiring.lawyerProfileId)

      return response.status(201).json({
        success: true,
        data: {
          review: {
            id: review.id,
            rating: review.rating,
            feedback: review.feedback,
            createdAt: review.createdAt,
          },
        },
      })
    } catch (error) {
      if (error?.code === 11000) throw fail('This engagement has already been reviewed.', 409, 'REVIEW_ALREADY_EXISTS')
      throw error
    }
  } catch (error) {
    return next(error)
  }
}

const REVIEWER_POPULATE = { path: 'userId', select: 'fullName profileImageUrl' }

function safePublicReview(review) {
  return {
    id: review._id.toString(),
    rating: review.rating,
    feedback: review.feedback,
    createdAt: review.createdAt,
    reviewer: {
      fullName: review.userId?.fullName ?? 'LegalEase client',
      profileImageUrl: review.userId?.profileImageUrl || '',
    },
  }
}

async function resolveEligibleProfile(profileId) {
  if (!isValidId(profileId)) throw fail('This lawyer is not publicly available.', 404, 'LAWYER_NOT_FOUND')
  const profile = await LawyerProfile.findOne({
    _id: profileId,
    publicationStatus: 'published',
    verificationStatus: 'paid',
  }).populate({ path: 'userId', match: { role: 'lawyer', status: 'active' }, select: '_id' })
  if (!profile?.userId) throw fail('This lawyer is not publicly available.', 404, 'LAWYER_NOT_FOUND')
  return profile
}

export async function listLawyerReviews(request, response, next) {
  try {
    const profile = await resolveEligibleProfile(request.params.profileId)
    const query = request.validatedQuery
    const filter = { lawyerProfileId: profile.id }

    const [items, totalItems, distribution] = await Promise.all([
      Review.find(filter)
        .populate(REVIEWER_POPULATE)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      Review.countDocuments(filter),
      Review.aggregate([
        { $match: { lawyerProfileId: profile._id } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
    ])

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const entry of distribution) ratingCounts[entry._id] = entry.count

    return response.json({
      success: true,
      data: {
        items: items.map(safePublicReview),
        averageRating: profile.averageRating,
        reviewCount: totalItems,
        ratingCounts,
      },
      meta: {
        page: query.page,
        pageSize: query.limit,
        totalItems,
        totalPages: Math.ceil(totalItems / query.limit),
      },
    })
  } catch (error) {
    return next(error)
  }
}

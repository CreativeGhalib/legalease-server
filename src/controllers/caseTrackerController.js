import mongoose from 'mongoose'
import { CaseMilestone, FORWARD_STATUSES, MAX_MILESTONES_PER_CASE } from '../models/CaseMilestone.js'
import { HiringRequest } from '../models/HiringRequest.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

export async function resolveEngagementFor(user, hiringRequestId) {
  if (!isValidId(hiringRequestId)) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')
  const engagement = await HiringRequest.findById(hiringRequestId)
  if (!engagement) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')

  const isClient = String(engagement.clientId) === String(user.id)
  const isLawyer = String(engagement.lawyerId) === String(user.id)
  if (!isClient && !isLawyer) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')

  if (engagement.status !== 'accepted' || engagement.paymentStatus !== 'paid') {
    throw fail('Case tracking activates after the consultation fee is paid.', 403, 'CASE_NOT_ELIGIBLE')
  }

  return { engagement, isLawyer }
}

function safeMilestone(milestone) {
  return {
    id: milestone._id.toString(),
    title: milestone.title,
    description: milestone.description,
    status: milestone.status,
    order: milestone.order,
    dueDate: milestone.dueDate,
    completedAt: milestone.completedAt,
    createdAt: milestone.createdAt,
    updatedAt: milestone.updatedAt,
  }
}

export async function getCaseTimeline(request, response, next) {
  try {
    const { engagement } = await resolveEngagementFor(request.auth.user, request.params.hiringRequestId)

    const milestones = await CaseMilestone.find({ hiringRequestId: engagement._id }).sort({ order: 1, createdAt: 1 })
    const completed = milestones.filter((milestone) => milestone.status === 'completed').length

    return response.json({
      success: true,
      data: {
        engagement: {
          id: String(engagement._id),
          status: engagement.status,
          paymentStatus: engagement.paymentStatus,
          specializationSnapshot: engagement.specializationSnapshot,
          feeMinorSnapshot: engagement.feeMinorSnapshot,
          currency: engagement.currency,
        },
        summary: { total: milestones.length, completed },
        milestones: milestones.map(safeMilestone),
      },
    })
  } catch (error) {
    return next(error)
  }
}

export async function createMilestone(request, response, next) {
  try {
    const { engagement, isLawyer } = await resolveEngagementFor(request.auth.user, request.params.hiringRequestId)
    if (!isLawyer) throw fail('Only the lawyer of record can add milestones.', 403, 'CASE_NOT_OWNED_BY_LAWYER')

    const count = await CaseMilestone.countDocuments({ hiringRequestId: engagement._id })
    if (count >= MAX_MILESTONES_PER_CASE) {
      throw fail(`A case can hold at most ${MAX_MILESTONES_PER_CASE} milestones.`, 409, 'MILESTONE_LIMIT_REACHED')
    }

    const milestone = await CaseMilestone.create({
      hiringRequestId: engagement._id,
      createdByLawyerId: request.auth.user.id,
      title: request.body.title,
      description: request.body.description ?? '',
      dueDate: request.body.dueDate ?? null,
      order: request.body.order ?? count,
    })

    return response.status(201).json({ success: true, data: { milestone: safeMilestone(milestone) } })
  } catch (error) {
    return next(error)
  }
}

async function requireOwnedMilestone(milestoneId, user) {
  if (!isValidId(milestoneId)) throw fail('Milestone was not found.', 404, 'CASE_NOT_FOUND')
  const milestone = await CaseMilestone.findById(milestoneId)
  if (!milestone) throw fail('Milestone was not found.', 404, 'CASE_NOT_FOUND')

  const engagement = await HiringRequest.findById(milestone.hiringRequestId)
  if (!engagement || String(engagement.lawyerId) !== String(user.id)) {
    throw fail('Milestone was not found.', 404, 'CASE_NOT_FOUND')
  }
  return { milestone, engagement }
}

export async function updateMilestone(request, response, next) {
  try {
    const { milestone, engagement } = await requireOwnedMilestone(request.params.id, request.auth.user)
    const body = request.body

    if (body.status && body.status !== milestone.status) {
      const currentIndex = FORWARD_STATUSES.indexOf(milestone.status)
      const nextIndex = FORWARD_STATUSES.indexOf(body.status)
      if (nextIndex < currentIndex) {
        throw fail('Milestones cannot move backwards.', 409, 'INVALID_MILESTONE_TRANSITION')
      }
      milestone.status = body.status
    }

    if (body.title !== undefined) milestone.title = body.title
    if (body.description !== undefined) milestone.description = body.description
    if (body.dueDate !== undefined) milestone.dueDate = body.dueDate

    if (milestone.status === 'completed' && !milestone.completedAt) {
      milestone.completedAt = new Date()
    }
    if (milestone.status !== 'completed') milestone.completedAt = null
    else if (!engagement) throw fail('Case was not found.', 404, 'CASE_NOT_FOUND')

    await milestone.save()
    return response.json({ success: true, data: { milestone: safeMilestone(milestone) } })
  } catch (error) {
    return next(error)
  }
}

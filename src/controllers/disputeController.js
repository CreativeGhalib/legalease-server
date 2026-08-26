import { Dispute } from '../models/Dispute.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { openDispute } from '../services/disputeService.js'

function safeDispute(dispute) {
  return {
    id: dispute._id.toString(),
    hiringRequestId: String(dispute.hiringRequestId),
    openedByRole: dispute.openedByRole,
    reason: dispute.reason,
    status: dispute.status,
    resolutionNote: dispute.resolutionNote || '',
    createdAt: dispute.createdAt,
    resolvedAt: dispute.updatedAt,
  }
}

export async function openCaseDispute(request, response, next) {
  try {
    const dispute = await openDispute(request.auth.user, request.body)
    return response.status(201).json({ success: true, data: { dispute: safeDispute(dispute) } })
  } catch (error) {
    return next(error)
  }
}

export async function listMyDisputes(request, response, next) {
  try {
    const myOpenOrOpened = await Dispute.find({ openedById: request.auth.user.id })
      .sort({ createdAt: -1, _id: -1 })
      .populate('hiringRequestId', 'specializationSnapshot feeMinorSnapshot currency')

    const engagementIds = new Set(myOpenOrOpened.map((dispute) => String(dispute.hiringRequestId?._id ?? dispute.hiringRequestId)))
    const engagements = await HiringRequest.find({
      $or: [
        { clientId: request.auth.user.id },
        { lawyerId: request.auth.user.id },
      ],
    }).select('_id')
    for (const engagement of engagements) {
      if (!engagementIds.has(String(engagement._id))) engagementIds.add(String(engagement._id))
    }

    const involved = await Dispute.find({
      hiringRequestId: { $in: [...engagementIds] },
    })
      .sort({ createdAt: -1, _id: -1 })
      .populate('hiringRequestId', 'specializationSnapshot feeMinorSnapshot currency')

    const seen = new Set()
    const items = involved
      .filter((dispute) => {
        const id = dispute._id.toString()
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map(safeDispute)

    return response.json({ success: true, data: { items } })
  } catch (error) {
    return next(error)
  }
}

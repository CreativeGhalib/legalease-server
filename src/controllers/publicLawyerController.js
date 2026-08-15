import mongoose from 'mongoose'
import { LawyerProfile } from '../models/LawyerProfile.js'

export const PUBLIC_PAGE_SIZE = 8

const ELIGIBLE_PROFILE_MATCH = {
  publicationStatus: 'published',
  verificationStatus: 'paid',
}

const userLookup = {
  $lookup: {
    from: 'users',
    let: { lawyerUserId: '$userId' },
    pipeline: [
      { $match: { $expr: { $and: [
        { $eq: ['$_id', '$$lawyerUserId'] },
        { $eq: ['$role', 'lawyer'] },
        { $eq: ['$status', 'active'] },
      ] } } },
      { $project: { fullName: 1, createdAt: 1 } },
    ],
    as: 'lawyerUser',
  },
}

export const publicLawyerProjection = {
  _id: 0,
  id: '$_id',
  fullName: '$lawyerUser.fullName',
  professionalPhotoUrl: 1,
  specialization: 1,
  additionalSpecializations: 1,
  bio: 1,
  consultationFeeMinor: 1,
  currency: 1,
  experienceYears: 1,
  licenseNumber: 1,
  location: 1,
  languages: 1,
  availability: 1,
  paidHireCount: 1,
  joinedAt: '$lawyerUser.createdAt',
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function publicLawyerPipeline({ search, specialization, minFee, maxFee, availability, sort = 'newest' } = {}) {
  const pipeline = [
    { $match: ELIGIBLE_PROFILE_MATCH },
    userLookup,
    { $unwind: '$lawyerUser' },
  ]
  const matches = []
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i')
    matches.push({ $or: [{ 'lawyerUser.fullName': expression }, { specialization: expression }, { additionalSpecializations: expression }] })
  }
  if (specialization) {
    const expression = new RegExp(`^${escapeRegex(specialization)}$`, 'i')
    matches.push({ $or: [{ specialization: expression }, { additionalSpecializations: expression }] })
  }
  if (minFee !== undefined || maxFee !== undefined) {
    const fee = {}
    if (minFee !== undefined) fee.$gte = minFee
    if (maxFee !== undefined) fee.$lte = maxFee
    matches.push({ consultationFeeMinor: fee })
  }
  if (availability) matches.push({ availability })
  if (matches.length) pipeline.push({ $match: matches.length === 1 ? matches[0] : { $and: matches } })
  const sorts = {
    newest: { createdAt: -1, _id: -1 },
    'fee-low': { consultationFeeMinor: 1, _id: 1 },
    'fee-high': { consultationFeeMinor: -1, _id: -1 },
    'most-hired': { paidHireCount: -1, createdAt: -1, _id: -1 },
  }
  return { pipeline, sort: sorts[sort] }
}

function notAvailableError() {
  return Object.assign(new Error('This lawyer is not available.'), { statusCode: 404, code: 'LAWYER_NOT_FOUND' })
}

export async function listPublicLawyers(request, response, next) {
  try {
    const query = request.validatedQuery
    const { pipeline, sort } = publicLawyerPipeline(query)
    const pageSize = query.limit ?? PUBLIC_PAGE_SIZE
    const [result] = await LawyerProfile.aggregate([
      ...pipeline,
      { $facet: {
        items: [{ $sort: sort }, { $skip: (query.page - 1) * pageSize }, { $limit: pageSize }, { $project: publicLawyerProjection }],
        total: [{ $count: 'totalItems' }],
      } },
    ])
    const totalItems = result.total[0]?.totalItems ?? 0
    return response.json({ success: true, data: { items: result.items }, meta: { page: query.page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } })
  } catch (error) { return next(error) }
}

export async function getPublicLawyer(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) throw notAvailableError()
    const { pipeline } = publicLawyerPipeline()
    const [lawyer] = await LawyerProfile.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(request.params.id) } }, ...pipeline, { $project: publicLawyerProjection }])
    if (!lawyer) throw notAvailableError()
    return response.json({ success: true, data: { lawyer } })
  } catch (error) { return next(error) }
}

export async function listFeaturedLawyers(_request, response, next) {
  try {
    const { pipeline, sort } = publicLawyerPipeline()
    const items = await LawyerProfile.aggregate([...pipeline, { $sort: sort }, { $limit: 6 }, { $project: publicLawyerProjection }])
    return response.json({ success: true, data: { items } })
  } catch (error) { return next(error) }
}

export async function listTopLawyers(_request, response, next) {
  try {
    const { pipeline, sort } = publicLawyerPipeline({ sort: 'most-hired' })
    const items = await LawyerProfile.aggregate([...pipeline, { $sort: sort }, { $limit: 3 }, { $project: publicLawyerProjection }])
    return response.json({ success: true, data: { items } })
  } catch (error) { return next(error) }
}

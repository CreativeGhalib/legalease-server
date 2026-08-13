import mongoose from 'mongoose'
import { Comment } from '../models/Comment.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { LawyerProfile } from '../models/LawyerProfile.js'

const error = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code })
const validId = (id) => mongoose.isObjectIdOrHexString(id)
const unavailable = () => error('This lawyer profile is not publicly available.', 404, 'LAWYER_NOT_FOUND')
const safe = (comment) => ({ id: comment._id.toString(), content: comment.content, createdAt: comment.createdAt, updatedAt: comment.updatedAt, author: { fullName: comment.authorId.fullName, profileImageUrl: comment.authorId.profileImageUrl || '' } })

async function publicProfile(profileId) {
  if (!validId(profileId)) throw unavailable()
  const profile = await LawyerProfile.findOne({ _id: profileId, publicationStatus: 'published', verificationStatus: 'paid' }).populate({ path: 'userId', match: { role: 'lawyer', status: 'active' }, select: 'fullName' })
  if (!profile?.userId) throw unavailable()
  return profile
}

export async function listPublicComments(request, response, next) {
  try {
    await publicProfile(request.params.profileId)
    const comments = await Comment.find({ lawyerProfileId: request.params.profileId }).populate('authorId', 'fullName profileImageUrl').sort({ createdAt: -1, _id: -1 })
    return response.json({ success: true, data: { items: comments.map(safe) } })
  } catch (err) { return next(err) }
}

export async function createComment(request, response, next) {
  try {
    if (!validId(request.params.profileId)) throw error('Lawyer profile was not found.', 404, 'LAWYER_NOT_FOUND')
    const profile = await LawyerProfile.findOne({ _id: request.params.profileId, publicationStatus: { $ne: 'deleted' } })
    if (!profile) throw error('Lawyer profile was not found.', 404, 'LAWYER_NOT_FOUND')
    const hiring = await HiringRequest.findOne({ clientId: request.auth.user._id, lawyerId: profile.userId, lawyerProfileId: profile._id, status: 'accepted', paymentStatus: 'paid' })
    if (!hiring) throw error('Only clients with an accepted, paid hire can comment.', 403, 'COMMENT_NOT_ELIGIBLE')
    try {
      const comment = await Comment.create({ authorId: request.auth.user._id, lawyerId: profile.userId, lawyerProfileId: profile._id, hiringRequestId: hiring._id, content: request.body.content })
      await comment.populate('authorId', 'fullName profileImageUrl')
      return response.status(201).json({ success: true, data: { comment: safe(comment) } })
    } catch (err) {
      if (err?.code === 11000) throw error('You already have a comment for this lawyer.', 409, 'COMMENT_ALREADY_EXISTS')
      throw err
    }
  } catch (err) { return next(err) }
}

export async function listMine(request, response, next) {
  try {
    const comments = await Comment.find({ authorId: request.auth.user._id }).populate({ path: 'lawyerProfileId', select: 'professionalPhotoUrl specialization publicationStatus', populate: { path: 'userId', select: 'fullName' } }).sort({ createdAt: -1, _id: -1 })
    const items = comments.map((comment) => ({ id: comment._id.toString(), content: comment.content, createdAt: comment.createdAt, updatedAt: comment.updatedAt, lawyerProfileId: comment.lawyerProfileId?._id?.toString() || null, lawyer: comment.lawyerProfileId ? { fullName: comment.lawyerProfileId.userId?.fullName || 'Lawyer profile unavailable', professionalPhotoUrl: comment.lawyerProfileId.professionalPhotoUrl || '', specialization: comment.lawyerProfileId.specialization || '', publiclyAvailable: comment.lawyerProfileId.publicationStatus === 'published' } : null }))
    return response.json({ success: true, data: { items } })
  } catch (err) { return next(err) }
}

async function ownComment(id, userId) {
  if (!validId(id)) throw error('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
  const comment = await Comment.findOne({ _id: id, authorId: userId })
  if (!comment) throw error('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
  return comment
}
export async function updateComment(request, response, next) { try { const comment = await ownComment(request.params.id, request.auth.user._id); comment.content = request.body.content; await comment.save(); await comment.populate('authorId', 'fullName profileImageUrl'); return response.json({ success: true, data: { comment: safe(comment) } }) } catch (err) { return next(err) } }
export async function deleteComment(request, response, next) {
  try {
    if (!validId(request.params.id)) throw error('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
    const comment = request.auth.user.role === 'admin' ? await Comment.findById(request.params.id) : await Comment.findOne({ _id: request.params.id, authorId: request.auth.user._id })
    if (!comment) throw error('Comment was not found.', 404, 'COMMENT_NOT_FOUND')
    await comment.deleteOne()
    return response.status(204).end()
  } catch (err) { return next(err) }
}

import mongoose from 'mongoose'
import { HiringRequest } from '../models/HiringRequest.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { User } from '../models/User.js'
import { sendHireDecisionEmail, sendHireRequestEmail } from './emailService.js'

function fail(message, statusCode, code) { return Object.assign(new Error(message), { statusCode, code }) }
function safeRequest(request, viewer) {
  const base = { id: request.id, lawyerProfileId: String(request.lawyerProfileId?._id ?? request.lawyerProfileId), specializationSnapshot: request.specializationSnapshot, feeMinorSnapshot: request.feeMinorSnapshot, currency: request.currency, status: request.status, paymentStatus: request.paymentStatus, createdAt: request.createdAt, decisionAt: request.decisionAt, paidAt: request.paidAt }
  if (viewer === 'client') return { ...base, lawyer: { id: String(request.lawyerId?._id ?? request.lawyerId), fullName: request.lawyerId?.fullName ?? '', professionalPhotoUrl: request.lawyerProfileId?.professionalPhotoUrl ?? '' } }
  return { ...base, client: { id: String(request.clientId?._id ?? request.clientId), fullName: request.clientId?.fullName ?? '', email: request.clientId?.email ?? '', profileImageUrl: request.clientId?.profileImageUrl ?? '' } }
}
const clientPopulate = [{ path: 'lawyerId', select: 'fullName' }, { path: 'lawyerProfileId', select: 'professionalPhotoUrl' }]
const lawyerPopulate = [{ path: 'clientId', select: 'fullName email profileImageUrl' }]

export async function createHiringRequest(client, lawyerProfileId) {
  if (!mongoose.isObjectIdOrHexString(lawyerProfileId)) throw fail('This lawyer is not available for hire.', 404, 'LAWYER_NOT_HIREABLE')
  const profile = await LawyerProfile.findById(lawyerProfileId)
  if (!profile || profile.publicationStatus !== 'published' || profile.verificationStatus !== 'paid' || profile.availability !== 'available') throw fail('This lawyer is not available for hire.', 404, 'LAWYER_NOT_HIREABLE')
  if (String(profile.userId) === String(client.id)) throw fail('You cannot hire yourself.', 400, 'SELF_HIRE_FORBIDDEN')
  const lawyer = await User.findOne({ _id: profile.userId, role: 'lawyer', status: 'active' })
  if (!lawyer) throw fail('This lawyer is not available for hire.', 404, 'LAWYER_NOT_HIREABLE')
  try {
    const request = await HiringRequest.create({ clientId: client.id, lawyerId: lawyer.id, lawyerProfileId: profile.id, specializationSnapshot: profile.specialization, feeMinorSnapshot: profile.consultationFeeMinor, currency: profile.currency, status: 'pending', paymentStatus: 'unpaid' })
    await sendHireRequestEmail(lawyer, client, request)
    return safeRequest(await request.populate(clientPopulate), 'client')
  } catch (error) {
    if (error?.code === 11000) throw fail('You already have a hiring request with this lawyer.', 409, 'HIRING_REQUEST_ALREADY_EXISTS')
    throw error
  }
}

export async function listClientRequests(clientId) { return (await HiringRequest.find({ clientId }).sort({ createdAt: -1, _id: -1 }).populate(clientPopulate)).map((request) => safeRequest(request, 'client')) }
export async function listLawyerRequests(lawyerId) { return (await HiringRequest.find({ lawyerId }).sort({ createdAt: -1, _id: -1 }).populate(lawyerPopulate)).map((request) => safeRequest(request, 'lawyer')) }

export async function getScopedRequest(id, user) {
  if (!mongoose.isObjectIdOrHexString(id)) throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
  const request = await HiringRequest.findById(id).populate(user.role === 'user' ? clientPopulate : lawyerPopulate)
  if (!request || (String(request.clientId?._id ?? request.clientId) !== String(user.id) && String(request.lawyerId?._id ?? request.lawyerId) !== String(user.id))) throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
  return safeRequest(request, String(request.clientId?._id ?? request.clientId) === String(user.id) ? 'client' : 'lawyer')
}

export async function decideHiringRequest(id, lawyer, decision) {
  if (!mongoose.isObjectIdOrHexString(id)) throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
  const request = await HiringRequest.findOneAndUpdate({ _id: id, lawyerId: lawyer.id, status: 'pending' }, { $set: { status: decision, decisionAt: new Date() } }, { returnDocument: 'after' }).populate(lawyerPopulate)
  if (request) {
    await sendHireDecisionEmail(request.clientId, lawyer, decision)
    return safeRequest(request, 'lawyer')
  }
  const existing = await HiringRequest.findById(id).select('lawyerId status')
  if (!existing || String(existing.lawyerId) !== String(lawyer.id)) throw fail('Hiring request was not found.', 404, 'HIRING_REQUEST_NOT_FOUND')
  throw fail('Only a pending hiring request can be decided once.', 409, 'HIRING_REQUEST_ALREADY_DECIDED')
}

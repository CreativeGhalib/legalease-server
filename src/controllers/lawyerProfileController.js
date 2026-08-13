import { LawyerProfile } from '../models/LawyerProfile.js'

function toProfileResponse(profile) {
  return {
    id: profile.id,
    professionalPhotoUrl: profile.professionalPhotoUrl,
    specialization: profile.specialization,
    additionalSpecializations: profile.additionalSpecializations,
    bio: profile.bio,
    consultationFeeMinor: profile.consultationFeeMinor,
    currency: profile.currency,
    experienceYears: profile.experienceYears,
    licenseNumber: profile.licenseNumber,
    location: profile.location,
    languages: profile.languages,
    availability: profile.availability,
    verificationStatus: profile.verificationStatus,
    publicationStatus: profile.publicationStatus,
    isCompleteForPublishing: Boolean(profile.professionalPhotoUrl && profile.specialization && profile.bio && profile.consultationFeeMinor > 0 && Number.isInteger(profile.experienceYears) && profile.experienceYears >= 0 && profile.licenseNumber),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function missingProfileError() {
  const error = new Error('Create your professional profile before editing it.')
  error.statusCode = 404
  error.code = 'LAWYER_PROFILE_NOT_FOUND'
  return error
}

export async function getMyLawyerProfile(request, response, next) {
  try {
    const profile = await LawyerProfile.findOne({ userId: request.auth.user.id })
    if (!profile || profile.publicationStatus === 'deleted') throw missingProfileError()
    return response.json({ success: true, data: { profile: toProfileResponse(profile) } })
  } catch (error) { return next(error) }
}

export async function createMyLawyerProfile(request, response, next) {
  try {
    const existing = await LawyerProfile.findOne({ userId: request.auth.user.id })
    if (existing && existing.publicationStatus !== 'deleted') {
      const error = new Error('You already have a professional profile.')
      error.statusCode = 409
      error.code = 'LAWYER_PROFILE_ALREADY_EXISTS'
      throw error
    }
    const profile = existing ?? new LawyerProfile({ userId: request.auth.user.id })
    if (existing) {
      if (existing.deletedByRole === 'admin') {
        const error = new Error('This profile is unavailable. Contact an administrator for help.')
        error.statusCode = 403
        error.code = 'LAWYER_PROFILE_ADMIN_DELETED'
        throw error
      }
      profile.publicationStatus = 'draft'
      profile.deletedAt = null
      profile.deletedByRole = null
    }
    Object.assign(profile, request.body)
    await profile.save()
    return response.status(existing ? 200 : 201).json({ success: true, data: { profile: toProfileResponse(profile) } })
  } catch (error) { return next(error?.code === 11000 ? Object.assign(new Error('You already have a professional profile.'), { statusCode: 409, code: 'LAWYER_PROFILE_ALREADY_EXISTS' }) : error) }
}

export async function updateMyLawyerProfile(request, response, next) {
  try {
    const profile = await LawyerProfile.findOne({ userId: request.auth.user.id })
    if (!profile || profile.publicationStatus === 'deleted') throw missingProfileError()
    Object.assign(profile, request.body)
    await profile.save()
    return response.json({ success: true, data: { profile: toProfileResponse(profile) } })
  } catch (error) { return next(error) }
}

export async function deleteMyLawyerProfile(request, response, next) {
  try {
    const profile = await LawyerProfile.findOne({ userId: request.auth.user.id })
    if (!profile || profile.publicationStatus === 'deleted') throw missingProfileError()
    profile.publicationStatus = 'deleted'
    profile.deletedAt = new Date()
    profile.deletedByRole = 'lawyer'
    await profile.save()
    return response.json({ success: true, data: { message: 'Professional profile deleted.' } })
  } catch (error) { return next(error) }
}

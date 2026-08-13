import { env } from '../config/env.js'
import {
  createGoogleOnboardingToken,
  resolveGoogleIdentity,
  verifyGoogleCredential,
  verifyGoogleOnboardingToken,
} from '../services/googleAuthService.js'
import {
  clearGoogleOnboardingCookie,
  createSessionToken,
  readCookie,
  setGoogleOnboardingCookie,
  setSessionCookie,
  toSafeUser,
} from '../utils/auth.js'

function sessionResponse(response, user) {
  setSessionCookie(response, createSessionToken(user))
  return response.status(200).json({ success: true, data: { user: toSafeUser(user) } })
}

export async function googleAuthenticate(request, response, next) {
  try {
    const identity = await verifyGoogleCredential(request.body.credential)
    const result = await resolveGoogleIdentity(identity, request.body.role)

    if (result.onboardingRequired) {
      setGoogleOnboardingCookie(response, createGoogleOnboardingToken(identity))
      return response.status(200).json({ success: true, data: { onboardingRequired: true } })
    }

    clearGoogleOnboardingCookie(response)
    return sessionResponse(response, result.user)
  } catch (error) {
    return next(error)
  }
}

export async function completeGoogleOnboarding(request, response, next) {
  try {
    const token = readCookie(request, env.GOOGLE_ONBOARDING_COOKIE_NAME)
    if (!token) {
      const error = new Error('Google onboarding has expired. Please sign in with Google again.')
      error.statusCode = 401
      error.code = 'GOOGLE_ONBOARDING_EXPIRED'
      throw error
    }

    const identity = verifyGoogleOnboardingToken(token)
    const result = await resolveGoogleIdentity(identity, request.body.role)
    clearGoogleOnboardingCookie(response)
    return sessionResponse(response, result.user)
  } catch (error) {
    clearGoogleOnboardingCookie(response)
    return next(error)
  }
}

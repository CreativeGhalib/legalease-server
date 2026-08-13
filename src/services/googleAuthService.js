import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'
import { User } from '../models/User.js'

const googleClient = new OAuth2Client()
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

function appError(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}

function activeAccount(user) {
  if (user.status !== 'active') throw appError('This account is unavailable.', 403, 'ACCOUNT_UNAVAILABLE')
  return user
}

function normalizedProfileImage(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export async function verifyGoogleCredential(credential) {
  if (!env.GOOGLE_CLIENT_ID) throw appError('Google sign-in is not configured.', 503, 'GOOGLE_AUTH_UNAVAILABLE')

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    const email = payload?.email?.trim().toLowerCase()

    if (!payload?.sub || !email || payload.email_verified !== true || !GOOGLE_ISSUERS.has(payload.iss)) {
      throw appError('Google identity verification failed.', 401, 'INVALID_GOOGLE_CREDENTIAL')
    }

    return {
      sub: payload.sub,
      email,
      fullName: payload.name?.trim().slice(0, 120) || 'Google User',
      profileImageUrl: normalizedProfileImage(payload.picture),
    }
  } catch (error) {
    if (error.statusCode) throw error
    throw appError('Google identity verification failed.', 401, 'INVALID_GOOGLE_CREDENTIAL')
  }
}

export async function resolveGoogleIdentity(identity, role) {
  const [subUser, emailUser] = await Promise.all([
    User.findOne({ googleSub: identity.sub }),
    User.findOne({ email: identity.email }),
  ])

  if (subUser && emailUser && subUser.id !== emailUser.id) {
    throw appError('Google identity cannot be linked to this account.', 409, 'GOOGLE_IDENTITY_CONFLICT')
  }

  const existingUser = subUser || emailUser
  if (existingUser) {
    activeAccount(existingUser)
    if (existingUser.googleSub && existingUser.googleSub !== identity.sub) {
      throw appError('Google identity cannot be linked to this account.', 409, 'GOOGLE_IDENTITY_CONFLICT')
    }
    if (!existingUser.googleSub) {
      existingUser.googleSub = identity.sub
      existingUser.providers = [...new Set([...existingUser.providers, 'google'])]
      try {
        await existingUser.save()
      } catch (error) {
        if (error?.code === 11000) throw appError('Google identity cannot be linked to this account.', 409, 'GOOGLE_IDENTITY_CONFLICT')
        throw error
      }
    }
    return { user: existingUser, onboardingRequired: false }
  }

  if (!role) return { user: null, onboardingRequired: true }

  try {
    const user = await User.create({
      fullName: identity.fullName,
      email: identity.email,
      profileImageUrl: identity.profileImageUrl,
      role,
      providers: ['google'],
      googleSub: identity.sub,
    })
    return { user, onboardingRequired: false }
  } catch (error) {
    if (error?.code === 11000) throw appError('An account already exists for this identity.', 409, 'GOOGLE_IDENTITY_CONFLICT')
    throw error
  }
}

export function createGoogleOnboardingToken(identity) {
  return jwt.sign(
    { ...identity, purpose: 'google_onboarding', jti: randomUUID() },
    env.GOOGLE_ONBOARDING_SECRET,
    { algorithm: 'HS256', expiresIn: '10m' },
  )
}

export function verifyGoogleOnboardingToken(token) {
  try {
    const payload = jwt.verify(token, env.GOOGLE_ONBOARDING_SECRET, { algorithms: ['HS256'] })
    if (payload.purpose !== 'google_onboarding' || !payload.sub || !payload.email) throw new Error('Invalid onboarding ticket.')
    return payload
  } catch {
    throw appError('Google onboarding has expired. Please sign in with Google again.', 401, 'GOOGLE_ONBOARDING_EXPIRED')
  }
}

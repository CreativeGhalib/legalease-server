import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export function createSessionToken(user) {
  return jwt.sign({ sub: user.id, tokenVersion: user.tokenVersion }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' })
}

export function verifySessionToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
}

export function sessionCookieOptions() {
  return { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }
}

export function setSessionCookie(response, token) {
  response.cookie(env.COOKIE_NAME, token, { ...sessionCookieOptions(), maxAge: SESSION_DURATION_MS })
}

export function clearSessionCookie(response) {
  response.clearCookie(env.COOKIE_NAME, sessionCookieOptions())
}

function googleOnboardingCookieOptions() {
  return { ...sessionCookieOptions(), path: '/api/auth/google' }
}

export function setGoogleOnboardingCookie(response, token) {
  response.cookie(env.GOOGLE_ONBOARDING_COOKIE_NAME, token, {
    ...googleOnboardingCookieOptions(),
    maxAge: 10 * 60 * 1000,
  })
}

export function clearGoogleOnboardingCookie(response) {
  response.clearCookie(env.GOOGLE_ONBOARDING_COOKIE_NAME, googleOnboardingCookieOptions())
}

export function readCookie(request, name) {
  const match = (request.headers.cookie?.split(';') ?? []).map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export function toSafeUser(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, profileImageUrl: user.profileImageUrl, role: user.role, status: user.status, createdAt: user.createdAt, updatedAt: user.updatedAt }
}

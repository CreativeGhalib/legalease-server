import { User } from '../models/User.js'
import { readCookie, verifySessionToken } from '../utils/auth.js'
import { env } from '../config/env.js'

function sessionError() {
  const error = new Error('Authentication is required.')
  error.statusCode = 401
  error.code = 'AUTHENTICATION_REQUIRED'
  return error
}

export async function authenticate(request, _response, next) {
  try {
    const token = readCookie(request, env.COOKIE_NAME)
    if (!token) throw sessionError()
    const payload = verifySessionToken(token)
    const user = await User.findById(payload.sub)
    if (!user || user.status !== 'active' || user.tokenVersion !== payload.tokenVersion) throw sessionError()
    request.auth = { user }
    return next()
  } catch (error) {
    // Log JWT-level errors in development so token issues are visible during debugging.
    // In production these are always replaced with a generic 401 — no internal detail leaks.
    if (!error.statusCode && process.env.NODE_ENV !== 'production') {
      console.debug('[authenticate] session validation failed:', error.message)
    }
    return next(error.statusCode ? error : sessionError())
  }
}

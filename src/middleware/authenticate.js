import { User } from '../models/User.js'
import { verifySessionToken } from '../utils/auth.js'
import { env } from '../config/env.js'

function readCookie(request, name) {
  const match = (request.headers.cookie?.split(';') ?? []).map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

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
    return next(error.statusCode ? error : sessionError())
  }
}

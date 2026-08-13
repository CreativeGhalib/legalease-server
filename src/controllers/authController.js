import bcrypt from 'bcrypt'
import { User } from '../models/User.js'
import { clearSessionCookie, createSessionToken, setSessionCookie, toSafeUser } from '../utils/auth.js'

function invalidCredentialsError() {
  const error = new Error('Invalid email or password.')
  error.statusCode = 401
  error.code = 'INVALID_CREDENTIALS'
  return error
}

function duplicateEmailError() {
  const error = new Error('An account already exists for this email address.')
  error.statusCode = 409
  error.code = 'EMAIL_ALREADY_REGISTERED'
  return error
}

export async function register(request, response, next) {
  try {
    const { fullName, email, password, role } = request.body
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ fullName, email, passwordHash, role, providers: ['local'] })
    setSessionCookie(response, createSessionToken(user))
    return response.status(201).json({ success: true, data: { user: toSafeUser(user) } })
  } catch (error) {
    return next(error?.code === 11000 ? duplicateEmailError() : error)
  }
}

export async function login(request, response, next) {
  try {
    const { email, password } = request.body
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !user.passwordHash || user.status !== 'active') throw invalidCredentialsError()
    if (!(await bcrypt.compare(password, user.passwordHash))) throw invalidCredentialsError()
    setSessionCookie(response, createSessionToken(user))
    return response.status(200).json({ success: true, data: { user: toSafeUser(user) } })
  } catch (error) {
    return next(error)
  }
}

export function getCurrentUser(request, response) {
  return response.status(200).json({ success: true, data: { user: toSafeUser(request.auth.user) } })
}

export function logout(_request, response) {
  clearSessionCookie(response)
  return response.status(200).json({ success: true, data: { message: 'Logged out successfully.' } })
}

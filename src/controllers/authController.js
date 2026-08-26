import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { User } from '../models/User.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { clearSessionCookie, createSessionToken, setSessionCookie, toSafeUser } from '../utils/auth.js'

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

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

function invalidResetTokenError() {
  const error = new Error('This password reset link is invalid or has expired.')
  error.statusCode = 400
  error.code = 'INVALID_RESET_TOKEN'
  return error
}

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

function dispatchPasswordResetEmail(email, resetUrl) {
  if (env.NODE_ENV === 'production') {
    logger.info('Password reset email dispatched.', { email })
    return
  }
  logger.info(`[dev] Password reset link for ${email}: ${resetUrl}`)
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

export async function forgotPassword(request, response, next) {
  try {
    const genericMessage = 'If an account exists for that email, a password reset link has been sent.'
    const user = await User.findOne({ email: request.body.email })
    if (!user || !user.passwordHash || user.status !== 'active') {
      return response.status(200).json({ success: true, data: { message: genericMessage } })
    }
    const rawToken = crypto.randomBytes(32).toString('hex')
    user.passwordResetToken = hashResetToken(rawToken)
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    await user.save()
    const resetUrl = `${env.clientOrigins[0]}/reset-password?token=${rawToken}`
    dispatchPasswordResetEmail(user.email, resetUrl)
    return response.status(200).json({ success: true, data: { message: genericMessage } })
  } catch (error) {
    return next(error)
  }
}

export async function resetPassword(request, response, next) {
  try {
    const user = await User.findOne({
      passwordResetToken: hashResetToken(request.body.token),
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordHash')
    if (!user || !user.passwordHash) throw invalidResetTokenError()
    user.passwordHash = await bcrypt.hash(request.body.password, 12)
    user.passwordResetToken = null
    user.passwordResetExpires = null
    user.tokenVersion += 1
    await user.save()
    setSessionCookie(response, createSessionToken(user))
    return response.status(200).json({
      success: true,
      data: { user: toSafeUser(user), message: 'Your password has been updated. You are now signed in.' },
    })
  } catch (error) {
    return next(error)
  }
}

export async function changePassword(request, response, next) {
  try {
    const { currentPassword, newPassword } = request.body
    const user = await User.findById(request.auth.user.id).select('+passwordHash')
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw invalidCredentialsError()
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12)
    user.tokenVersion += 1
    await user.save()
    setSessionCookie(response, createSessionToken(user))
    return response.status(200).json({
      success: true,
      data: { user: toSafeUser(user), message: 'Your password has been updated.' },
    })
  } catch (error) {
    return next(error)
  }
}

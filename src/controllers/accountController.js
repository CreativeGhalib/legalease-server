import bcrypt from 'bcrypt'
import { User } from '../models/User.js'
import { Appointment } from '../models/Appointment.js'
import { clearSessionCookie, setSessionCookie, createSessionToken, toSafeUser } from '../utils/auth.js'
import { deletionDueDate, finalizeAccountDeletionIfDue } from '../utils/accountDeletion.js'
import { logAudit, AUDIT_ACTIONS } from '../services/auditService.js'
import { sendMail } from '../config/mailer.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

async function verifyCredential(user, body) {
  if (user.passwordHash) {
    if (!body.password) throw fail('Password confirmation is required.', 400, 'VALIDATION_ERROR')
    return bcrypt.compare(body.password, user.passwordHash)
  }
  return Boolean(body.confirm)
}

export async function requestAccountDeletion(request, response, next) {
  try {
    const user = await User.findById(request.auth.user.id).select('+passwordHash +deletionRequestedAt')
    if (!user || user.status !== 'active') throw fail('Account was not found.', 404, 'USER_NOT_FOUND')

    const verified = await verifyCredential(user, request.body)
    if (!verified) throw fail('Invalid credentials.', 401, 'INVALID_CREDENTIALS')

    const dueDate = deletionDueDate()
    user.deletionRequestedAt = dueDate
    await user.save()

    void sendMail(
      user.email,
      'Account deletion scheduled — LegalEase',
      `<p>Your LegalEase account is scheduled for permanent deletion on ${dueDate.toDateString()}.
       Sign in before then to cancel. If this wasn't you, contact support immediately.</p>`,
    ).catch(() => undefined)

    return response.json({ success: true, data: { deletionRequestedAt: user.deletionRequestedAt.toISOString(), dueDate: dueDate.toISOString() } })
  } catch (error) {
    return next(error)
  }
}

export async function cancelAccountDeletion(request, response) {
  const updated = await User.findOneAndUpdate(
    { _id: request.auth.user.id, status: 'active' },
    { $unset: { deletionRequestedAt: '' } },
    { new: true },
  )
  if (!updated) {
    return response.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Account was not found.' } })
  }
  return response.json({ success: true, data: { cancelled: true } })
}

/** Lazy finalize shared by /auth/me and /users/me — responds 401 when it fires. */
export async function enforceDeletionWindow(request, response) {
  const finalized = await finalizeAccountDeletionIfDue(request.auth.user)
  if (!finalized) return false
  clearSessionCookie(response)
  response.status(401).json({
    success: false,
    error: { code: 'AUTHENTICATION_REQUIRED', message: 'This account has been deleted.' },
  })
  return true
}

export async function revokeAllSessions(request, response, next) {
  try {
    const user = await User.findById(request.auth.user.id).select('+passwordHash')
    if (!user || user.status !== 'active') throw fail('Account was not found.', 404, 'USER_NOT_FOUND')

    const verified = await verifyCredential(user, request.body)
    if (!verified) throw fail('Invalid credentials.', 401, 'INVALID_CREDENTIALS')

    user.tokenVersion += 1
    await user.save()

    setSessionCookie(response, createSessionToken(user))
    await logAudit({
      actorId: user._id,
      actorRole: user.role === 'lawyer' ? 'lawyer' : user.role,
      action: AUDIT_ACTIONS.SESSION_REVOKE_ALL,
      targetType: 'User',
      targetId: String(user._id),
      ip: request.ip,
    })

    return response.json({
      success: true,
      data: { user: toSafeUser(user), message: 'All other sessions have been signed out.' },
    })
  } catch (error) {
    return next(error)
  }
}

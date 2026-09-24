import { User } from '../models/User.js'
import { UserSession } from '../models/UserSession.js'
import { logger } from '../config/logger.js'
import { createSessionToken, setSessionCookie } from '../utils/auth.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function sessionDto(session, currentSid) {
  return {
    sid: session.sid,
    isCurrent: session.sid === currentSid,
    userAgent: session.userAgent || 'Unknown device',
    ip: session.ip || 'Unknown',
    lastSeen: session.lastSeen,
    createdAt: session.createdAt,
  }
}

/**
 * GET /api/auth/sessions
 * Returns the 20 most recently active sessions for the current user.
 */
export async function listSessions(request, response, next) {
  try {
    const sessions = await UserSession.find({ userId: request.auth.user.id, revokedAt: null })
      .sort({ lastSeen: -1 })
      .limit(20)
      .lean()
    return response.json({
      success: true,
      data: {
        sessions: sessions.map((s) => sessionDto(s, request.auth.sid)),
        count: sessions.length,
      },
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * DELETE /api/auth/sessions/:sid
 * Revokes a specific session by sid — must belong to the current user.
 */
export async function revokeSession(request, response, next) {
  try {
    const { sid } = request.params
    if (!sid || typeof sid !== 'string' || sid.length > 64) {
      throw fail('Invalid session identifier.', 400, 'INVALID_SESSION_ID')
    }
    const result = await UserSession.updateOne(
      { sid, userId: request.auth.user.id, revokedAt: null },
      { $set: { revokedAt: new Date(), lastSeen: new Date() } },
    )
    if (result.modifiedCount === 0) {
      throw fail('Session not found or does not belong to you.', 404, 'SESSION_NOT_FOUND')
    }
    logger.info('Session revoked.', { userId: request.auth.user.id, sid })
    return response.json({ success: true, data: { message: 'Session revoked.' } })
  } catch (error) {
    return next(error)
  }
}

/**
 * DELETE /api/auth/sessions
 * Revokes all previous sessions and issues a replacement token for this device.
 */
export async function revokeAllSessions(request, response, next) {
  try {
    const userId = request.auth.user.id
    const user = await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { new: true })
    if (!user) throw fail('Account was not found.', 404, 'USER_NOT_FOUND')
    await UserSession.deleteMany({ userId })
    setSessionCookie(response, createSessionToken(user))
    logger.info('All sessions revoked.', { userId })
    return response.json({ success: true, data: { message: 'All other sessions have been revoked.' } })
  } catch (error) {
    return next(error)
  }
}

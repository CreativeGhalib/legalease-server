import { User } from '../models/User.js'
import { UserSession } from '../models/UserSession.js'
import { logger } from '../config/logger.js'

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
    const sessions = await UserSession.find({ userId: request.auth.user.id })
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
    const result = await UserSession.deleteOne({ sid, userId: request.auth.user.id })
    if (result.deletedCount === 0) {
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
 * Revokes ALL sessions for the current user by bumping tokenVersion.
 * This immediately invalidates all JWTs — user stays logged into current session
 * only because they'll need to re-login everywhere else.
 */
export async function revokeAllSessions(request, response, next) {
  try {
    const userId = request.auth.user.id
    // Bump tokenVersion to invalidate all existing JWTs at once
    await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } })
    // Clean up session records
    await UserSession.deleteMany({ userId })
    logger.info('All sessions revoked.', { userId })
    return response.json({ success: true, data: { message: 'All other sessions have been revoked.' } })
  } catch (error) {
    return next(error)
  }
}

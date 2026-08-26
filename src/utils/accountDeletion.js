import { Appointment } from '../models/Appointment.js'
import { User } from '../models/User.js'
import { logAudit, AUDIT_ACTIONS } from '../services/auditService.js'
import { dhakaTodayKey } from './slots.js'

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

function anonymizeSet(userId) {
  return {
    fullName: 'Deleted User',
    email: `deleted+${String(userId)}@legalease.invalid`,
    profileImageUrl: '',
    status: 'deactivated',
  }
}

function anonymizeUnset() {
  return { googleSub: '', passwordHash: '', deletionRequestedAt: '' }
}

/**
 * Lazy grace-period finalizer. Runs conditionally wherever the account is
 * touched (login, /auth/me, /users/me). The conditional update is the
 * exactly-once guard — concurrent callers lose and return null.
 */
export async function finalizeAccountDeletionIfDue(user) {
  if (!user?.deletionRequestedAt || user.status !== 'active') return null
  if (user.deletionRequestedAt.getTime() > Date.now()) return null

  const updated = await User.findOneAndUpdate(
    { _id: user._id ?? user.id, deletionRequestedAt: user.deletionRequestedAt, status: 'active' },
    {
      $set: anonymizeSet(user._id ?? user.id),
      $unset: anonymizeUnset(),
      $inc: { tokenVersion: 1 },
    },
    { new: true },
  )
  if (!updated) return null

  try {
    await Appointment.updateMany(
      { userId: updated._id, status: 'scheduled', dateKey: { $gte: dhakaTodayKey() } },
      { $set: { status: 'cancelled' } },
    )
  } catch (cause) {
    void cause
  }

  await logAudit({
    action: AUDIT_ACTIONS.ACCOUNT_DELETE,
    actorRole: 'system',
    targetType: 'User',
    targetId: String(updated._id),
    meta: { graceExpiredAt: user.deletionRequestedAt.toISOString() },
  })

  return updated
}

export function deletionDueDate(from = new Date()) {
  return new Date(from.getTime() + GRACE_PERIOD_MS)
}

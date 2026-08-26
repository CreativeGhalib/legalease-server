import { AuditLog } from '../models/AuditLog.js'
import { logger } from '../config/logger.js'

export const AUDIT_ACTIONS = {
  TIER_CHANGE: 'tier.change',
  USER_DEACTIVATE: 'user.deactivate',
  USER_ACTIVATE: 'user.activate',
  LISTING_MODERATION: 'listing.moderate',
  DISPUTE_OPEN: 'dispute.open',
  DISPUTE_RESOLVE_REFUND: 'dispute.resolve.refund',
  DISPUTE_RESOLVE_RELEASE: 'dispute.resolve.release',
  ESCROW_CLIENT_CONFIRMED: 'escrow.client_confirmed',
  ESCROW_AUTO_7D: 'escrow.auto_7d',
  ESCROW_ADMIN: 'escrow.admin',
  PAYMENT_REFUND: 'payment.refund',
  SESSION_REVOKE_ALL: 'session.revoke_all',
  ACCOUNT_DELETE: 'account.delete',
}

const META_LIMIT_BYTES = 2048

function boundedMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  try {
    const serialized = JSON.stringify(meta)
    if (serialized.length <= META_LIMIT_BYTES) return meta
    return { truncated: serialized.slice(0, META_LIMIT_BYTES) }
  } catch {
    return { unserializable: true }
  }
}

/** Fail-open audit writer — mirrors createNotification doctrine: never throws. */
export async function logAudit({ actorId = null, actorRole = '', action, targetType = '', targetId = '', ip = '', meta = {} }) {
  try {
    await AuditLog.create({
      actorId,
      actorRole,
      action,
      targetType,
      targetId: targetId ? String(targetId).slice(0, 64) : '',
      ip: String(ip || '').slice(0, 64),
      meta: boundedMeta(meta),
    })
  } catch (error) {
    logger.warn('Audit log write failed.', { error: error.message, action })
  }
}

import mongoose from 'mongoose'

/**
 * Tracks each active JWT session (identified by the `sid` claim).
 * TTL index auto-removes sessions inactive for 30 days.
 * Fire-and-forget upserts in authenticate.js keep lastSeen current.
 */
const userSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sid: { type: String, required: true, unique: true },
  userAgent: { type: String, default: '', maxlength: 512 },
  ip: { type: String, default: '', maxlength: 64 },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true })

userSessionSchema.index({ userId: 1, lastSeen: -1 })
// Auto-delete sessions not seen in 30 days
userSessionSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export const UserSession = mongoose.model('UserSession', userSessionSchema)

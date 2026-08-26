import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, trim: true, default: '', maxlength: 30 },
  action: { type: String, required: true, trim: true, maxlength: 60 },
  targetType: { type: String, trim: true, default: '', maxlength: 30 },
  targetId: { type: String, trim: true, default: '', maxlength: 64 },
  ip: { type: String, trim: true, default: '', maxlength: 64 },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true })

auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ actorId: 1, createdAt: -1 })
auditLogSchema.index({ targetType: 1, targetId: 1 })

export const AuditLog = mongoose.model('AuditLog', auditLogSchema)

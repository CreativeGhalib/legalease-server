import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 400 },
  type: {
    type: String,
    enum: ['hire_request', 'hire_decision', 'payment', 'review', 'sla_expired', 'appointment', 'system'],
    required: true,
  },
  link: { type: String, trim: true, default: null, maxlength: 200 },
  isRead: { type: Boolean, default: false },
}, { timestamps: true })

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 })

export const Notification = mongoose.model('Notification', notificationSchema)

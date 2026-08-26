import mongoose from 'mongoose'

const caseMilestoneSchema = new mongoose.Schema({
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringRequest', required: true },
  createdByLawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  description: { type: String, trim: true, default: '', maxlength: 600 },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  order: { type: Number, min: 0, default: 0 },
  dueDate: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true })

caseMilestoneSchema.index({ hiringRequestId: 1, order: 1 })
caseMilestoneSchema.index({ hiringRequestId: 1, status: 1 })

export const CaseMilestone = mongoose.model('CaseMilestone', caseMilestoneSchema)

export const MAX_MILESTONES_PER_CASE = 20
export const FORWARD_STATUSES = ['pending', 'in_progress', 'completed']

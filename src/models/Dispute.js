import mongoose from 'mongoose'

const disputeSchema = new mongoose.Schema({
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringRequest', required: true },
  openedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  openedByRole: { type: String, enum: ['user', 'lawyer'], required: true },
  reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
  status: { type: String, enum: ['open', 'resolved_refund', 'resolved_release'], default: 'open' },
  resolvedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolutionNote: { type: String, trim: true, default: '', maxlength: 600 },
}, { timestamps: true })

// Canonical open-state: exactly one open dispute per engagement.
disputeSchema.index({ hiringRequestId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } })
disputeSchema.index({ status: 1, createdAt: -1 })
disputeSchema.index({ openedById: 1, createdAt: -1 })

disputeSchema.statics.hasOpenDispute = function (hiringRequestId) {
  return this.exists({ hiringRequestId, status: 'open' })
}

export const Dispute = mongoose.model('Dispute', disputeSchema)

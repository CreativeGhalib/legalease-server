import mongoose from 'mongoose'

const hiringRequestSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  specializationSnapshot: { type: String, required: true, trim: true, maxlength: 100 },
  feeMinorSnapshot: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, enum: ['USD'] },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'expired'], default: 'pending' },
  paymentStatus: { type: String, enum: ['unpaid', 'checkout_created', 'paid'], default: 'unpaid' },
  decisionAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  disputeStatus: { type: String, enum: [null, 'opened', 'resolved'], default: null },
}, { timestamps: true })

hiringRequestSchema.index({ clientId: 1, lawyerProfileId: 1 }, { unique: true })
hiringRequestSchema.index({ clientId: 1, createdAt: -1, _id: -1 })
hiringRequestSchema.index({ lawyerId: 1, createdAt: -1, _id: -1 })
hiringRequestSchema.index({ lawyerProfileId: 1, status: 1, paymentStatus: 1 })

export const HiringRequest = mongoose.model('HiringRequest', hiringRequestSchema)

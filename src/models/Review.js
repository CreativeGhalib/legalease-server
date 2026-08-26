import mongoose from 'mongoose'

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringRequest', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  feedback: { type: String, trim: true, default: '', maxlength: 1000 },
}, { timestamps: true })

reviewSchema.index({ hiringRequestId: 1 }, { unique: true })
reviewSchema.index({ lawyerProfileId: 1, createdAt: -1, _id: -1 })

export const Review = mongoose.model('Review', reviewSchema)

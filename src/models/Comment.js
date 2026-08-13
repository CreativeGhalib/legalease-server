import mongoose from 'mongoose'

const commentSchema = new mongoose.Schema({
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringRequest', required: true },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true })

commentSchema.index({ authorId: 1, lawyerProfileId: 1 }, { unique: true })
commentSchema.index({ lawyerProfileId: 1, createdAt: -1, _id: -1 })
commentSchema.index({ authorId: 1, createdAt: -1, _id: -1 })

export const Comment = mongoose.model('Comment', commentSchema)

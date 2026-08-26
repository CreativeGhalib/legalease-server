import mongoose from 'mongoose'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

const caseDocumentSchema = new mongoose.Schema({
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'HiringRequest', required: true },
  uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedByRole: { type: String, enum: ['user', 'lawyer'], required: true },
  imageUrl: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2048,
    validate: {
      validator: (value) => /^https:\/\/i\.ibb\.co\//i.test(value),
      message: 'Evidence images must be hosted by LegalEase image upload.',
    },
  },
  originalName: { type: String, trim: true, default: '', maxlength: 120 },
  mimeType: { type: String, enum: ALLOWED_MIME, required: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true })

caseDocumentSchema.index({ hiringRequestId: 1, createdAt: -1 })

export const CaseDocument = mongoose.model('CaseDocument', caseDocumentSchema)
export const MAX_DOCUMENTS_PER_CASE = 20
export const ALLOWED_DOCUMENT_MIME = ALLOWED_MIME

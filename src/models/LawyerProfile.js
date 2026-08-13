import mongoose from 'mongoose'

const lawyerProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  professionalPhotoUrl: { type: String, trim: true, default: '', maxlength: 2048 },
  specialization: { type: String, trim: true, default: '', maxlength: 100 },
  additionalSpecializations: { type: [String], default: [] },
  bio: { type: String, trim: true, default: '', maxlength: 3000 },
  consultationFeeMinor: { type: Number, min: 0, default: 0 },
  currency: { type: String, enum: ['USD'], default: 'USD' },
  experienceYears: { type: Number, min: 0, max: 80, default: null },
  licenseNumber: { type: String, trim: true, default: '', maxlength: 120 },
  location: { type: String, trim: true, default: '', maxlength: 160 },
  languages: { type: [String], default: [] },
  availability: { type: String, enum: ['available', 'busy'], default: 'available' },
  verificationStatus: { type: String, enum: ['unpaid', 'checkout_created', 'paid'], default: 'unpaid' },
  verificationPaidAt: { type: Date, default: null },
  publicationStatus: { type: String, enum: ['draft', 'published', 'unpublished', 'suspended', 'deleted'], default: 'draft' },
  deletedAt: { type: Date, default: null },
  deletedByRole: { type: String, enum: ['lawyer', 'admin', null], default: null },
  paidHireCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true })

export const LawyerProfile = mongoose.model('LawyerProfile', lawyerProfileSchema)

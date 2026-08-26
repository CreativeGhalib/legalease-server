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
  barAssociationBranch: { type: String, trim: true, default: '', maxlength: 120 },
  location: { type: String, trim: true, default: '', maxlength: 160 },
  languages: { type: [String], default: [] },
  workingHours: [{
    dayOfWeek: { type: Number, min: 0, max: 6 },
    slots: [{ start: { type: String }, end: { type: String } }],
  }],
  slotDurationMinutes: { type: Number, min: 15, max: 120, default: 30 },
  availability: { type: String, enum: ['available', 'busy'], default: 'available' },
  tier: { type: String, enum: ['bronze', 'silver', 'gold'], default: 'bronze' },
  averageRating: { type: Number, min: 0, max: 5, default: 0 },
  reviewCount: { type: Number, min: 0, default: 0 },
  verificationStatus: { type: String, enum: ['unpaid', 'checkout_created', 'paid'], default: 'unpaid' },
  verificationPaidAt: { type: Date, default: null },
  publicationStatus: { type: String, enum: ['draft', 'published', 'unpublished', 'suspended', 'deleted'], default: 'draft' },
  deletedAt: { type: Date, default: null },
  deletedByRole: { type: String, enum: ['lawyer', 'admin', null], default: null },
  paidHireCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true })

// userId uniqueness already defined inline above
lawyerProfileSchema.index({ publicationStatus: 1, availability: 1 })   // public browse filter
lawyerProfileSchema.index({ publicationStatus: 1, createdAt: -1, _id: -1 }) // admin pagination
lawyerProfileSchema.index({ verificationStatus: 1 })                    // payment eligibility checks
lawyerProfileSchema.index({                                              // full-text search
  specialization: 'text',
  fullName: 'text',
  bio: 'text',
}, {
  weights: { specialization: 10, fullName: 8, bio: 1 },
  name: 'lawyer_text_search',
})

export const LawyerProfile = mongoose.model('LawyerProfile', lawyerProfileSchema)

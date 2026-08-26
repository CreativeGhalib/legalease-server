import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, select: false },
  profileImageUrl: { type: String, default: '' },
  role: { type: String, enum: ['user', 'lawyer', 'admin'], required: true, default: 'user' },
  providers: { type: [String], enum: ['local', 'google'], default: ['local'] },
  googleSub: { type: String, sparse: true, unique: true },
   status: { type: String, enum: ['active', 'deactivated'], default: 'active' },
  tokenVersion: { type: Number, default: 0, min: 0 },
  failedLoginAttempts: { type: Number, default: 0, min: 0 },
  accountLockedUntil: { type: Date, select: false, default: null },
  passwordResetToken: { type: String, select: false, default: null },
  passwordResetExpires: { type: Date, select: false, default: null },
}, { timestamps: true })

// email uniqueness index already defined inline via `unique: true` on field
userSchema.index({ passwordResetToken: 1 }, { sparse: true }) // password reset lookup
userSchema.index({ role: 1, status: 1 })           // admin user filter queries
userSchema.index({ createdAt: -1, _id: -1 })        // admin pagination (newest first)
userSchema.index({ fullName: 'text', email: 'text' }, { // admin search by name/email
  weights: { fullName: 10, email: 5 },
  name: 'user_text_search',
})

export const User = mongoose.model('User', userSchema)

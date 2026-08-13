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
}, { timestamps: true })

userSchema.index({ email: 1 }, { unique: true })

export const User = mongoose.model('User', userSchema)

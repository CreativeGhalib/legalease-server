import mongoose from 'mongoose'

const leadNoteSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
}, { _id: true })

const chatLeadSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  phone: { type: String, required: true, trim: true, maxlength: 24 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  legalIssue: { type: String, trim: true, maxlength: 1500, default: '' },
  urgencyLevel: { type: String, enum: ['low', 'normal', 'urgent'], default: 'normal' },
  source: { type: String, enum: ['hero', 'exit_intent', 'callback', 'lawyer_profile', 'chatbot'], required: true },
  status: { type: String, enum: ['new', 'contacted', 'converted', 'cold'], default: 'new' },
  notes: { type: [leadNoteSchema], default: [] },
}, { timestamps: true })

chatLeadSchema.index({ status: 1, createdAt: -1, _id: -1 })
chatLeadSchema.index({ source: 1, createdAt: -1, _id: -1 })
chatLeadSchema.index({ phone: 1, createdAt: -1 })

export const ChatLead = mongoose.model('ChatLead', chatLeadSchema)

import mongoose from 'mongoose'

const appointmentSchema = new mongoose.Schema({
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  start: { type: String, required: true, match: /^([01]\d|2[0-3]):(00|30)$/ },
  end: { type: String, required: true, match: /^([01]\d|2[0-3]):(00|30)$/ },
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  meetingLink: { type: String, trim: true, default: '' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  amountMinor: { type: Number, min: 0, default: null },
  feeGateway: { type: String, enum: ['stripe', 'sslcommerz'], default: null },
}, { timestamps: true })

// Race-proof double-booking guard: one *active* appointment per lawyer/date/start.
appointmentSchema.index(
  { lawyerProfileId: 1, dateKey: 1, start: 1 },
  { unique: true, partialFilterExpression: { status: 'scheduled' } },
)
appointmentSchema.index({ userId: 1, dateKey: 1, start: 1 })
appointmentSchema.index({ lawyerProfileId: 1, dateKey: -1 })

export const Appointment = mongoose.model('Appointment', appointmentSchema)

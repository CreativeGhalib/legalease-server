import mongoose from 'mongoose'

const paymentTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['lawyer_verification', 'hiring_fee'], required: true },
  payerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, default: null },
  stripeCheckoutSessionId: { type: String, sparse: true, unique: true },
  stripePaymentIntentId: { type: String, sparse: true, unique: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, enum: ['usd'] },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paidAt: { type: Date, default: null },
}, { timestamps: true })

paymentTransactionSchema.index({ lawyerProfileId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'lawyer_verification' } })

export const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema)

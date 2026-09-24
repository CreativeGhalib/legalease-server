import mongoose from 'mongoose'

const paymentTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['lawyer_verification', 'hiring_fee', 'appointment_fee'], required: true },
  payerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lawyerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'LawyerProfile', required: true },
  hiringRequestId: { type: mongoose.Schema.Types.ObjectId, default: null },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  stripeCheckoutSessionId: { type: String, sparse: true, unique: true },
  stripePaymentIntentId: { type: String, sparse: true, unique: true },
  checkoutAttempt: { type: Number, default: 0, min: 0 },
  checkoutCreating: { type: Boolean, default: false },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, enum: ['usd'] },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paidAt: { type: Date, default: null },
  gateway: { type: String, enum: ['stripe', 'sslcommerz'], default: 'stripe' },
  gatewayTranId: { type: String, sparse: true, unique: true },
  gatewayValId: { type: String, sparse: true, unique: true },
  gatewayBankTranId: { type: String, default: null },
  gatewayAmountMinor: { type: Number, min: 1, default: null },
  gatewayCurrency: { type: String, enum: ['bdt'], default: null },
  gatewayRefundId: { type: String, sparse: true, unique: true },
  refundStatus: { type: String, enum: ['pending', 'succeeded', 'failed'], default: null },
  refundRequestedAt: { type: Date, default: null },
  refundRequestedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  refundNote: { type: String, default: '', maxlength: 600 },
  refundedAt: { type: Date, default: null },
  refundFailureReason: { type: String, default: '', maxlength: 500 },
  escrowStatus: { type: String, enum: ['held', 'released', 'disputed', 'refunded'], default: null },
  releaseReason: { type: String, enum: ['client_confirmed', 'auto_7d', 'admin'], default: null },
  releasedAt: { type: Date, default: null },
  refundAmountMinor: { type: Number, min: 0, default: null },
  platformCommissionMinor: { type: Number, min: 0, default: null },
  lawyerPayoutMinor: { type: Number, min: 0, default: null },
}, { timestamps: true })

paymentTransactionSchema.index({ lawyerProfileId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'lawyer_verification' } })
paymentTransactionSchema.index({ hiringRequestId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'hiring_fee' } })
paymentTransactionSchema.index({ appointmentId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'appointment_fee' } })

// stripeCheckoutSessionId and stripePaymentIntentId uniqueness defined inline above
paymentTransactionSchema.index({ payerId: 1, createdAt: -1, _id: -1 })  // user transaction history
paymentTransactionSchema.index({ lawyerId: 1, createdAt: -1, _id: -1 }) // lawyer transaction history
paymentTransactionSchema.index({ type: 1, status: 1, createdAt: -1 })   // admin filter + sort

export const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema)

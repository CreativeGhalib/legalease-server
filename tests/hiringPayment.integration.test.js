import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const uri = process.env.TEST_MONGODB_URI; const dbName = process.env.TEST_MONGODB_DB_NAME
test('hiring payment integrity integration', { skip: !(uri && dbName?.endsWith('_test')) && 'Set isolated Atlas test variables.' }, async (context) => {
  process.env.NODE_ENV = 'test'; process.env.MONGODB_URI = uri; process.env.MONGODB_DB_NAME = dbName; process.env.JWT_SECRET = randomBytes(48).toString('hex'); process.env.CLIENT_ORIGINS = 'http://localhost:5173'; process.env.STRIPE_SECRET_KEY = 'sk_test_phase8'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phase8'; process.env.LAWYER_PUBLISHING_FEE_CENTS = '5000'
  const [mongoose, { User }, { LawyerProfile }, { HiringRequest }, { PaymentTransaction }, service] = await Promise.all([import('mongoose'), import('../src/models/User.js'), import('../src/models/LawyerProfile.js'), import('../src/models/HiringRequest.js'), import('../src/models/PaymentTransaction.js'), import('../src/services/paymentService.js')])
  await mongoose.connect(uri, { dbName }); const label = `pay-${randomBytes(5).toString('hex')}`; const emails = [`${label}-user@x.test`, `${label}-lawyer@x.test`, `${label}-other@x.test`]
  context.after(async () => { const users = await User.find({ email: { $in: emails } }); await PaymentTransaction.deleteMany({ payerId: { $in: users } }); await HiringRequest.deleteMany({ clientId: { $in: users } }); await LawyerProfile.deleteMany({ userId: { $in: users } }); await User.deleteMany({ email: { $in: emails } }); await mongoose.disconnect() })
  const [user, lawyer, otherUser] = await User.create([{ fullName: 'Pay User', email: emails[0], role: 'user' }, { fullName: 'Pay Lawyer', email: emails[1], role: 'lawyer' }, { fullName: 'Other Pay User', email: emails[2], role: 'user' }])
  const profile = await LawyerProfile.create({ userId: lawyer.id, professionalPhotoUrl: 'https://i.ibb.co/p/a.png', specialization: 'Family Law', bio: 'Bio', consultationFeeMinor: 20000, experienceYears: 1, licenseNumber: 'P1', verificationStatus: 'paid', publicationStatus: 'published', availability: 'available' })
  const request = await HiringRequest.create({ clientId: user.id, lawyerId: lawyer.id, lawyerProfileId: profile.id, specializationSnapshot: 'Family Law', feeMinorSnapshot: 10000, currency: 'USD', status: 'accepted', paymentStatus: 'unpaid' })
  let creates = 0; const stripe = { checkout: { sessions: { retrieve: async (id) => id === 'cs_hire_1' ? { status: 'open', url: 'https://stripe.test/hire' } : { status: 'expired' }, create: async () => ({ id: `cs_hire_${++creates}`, url: 'https://stripe.test/hire' }) } } }
  await assert.rejects(service.createHiringCheckout(otherUser, request.id, { stripe }), (error) => error.code === 'HIRING_PAYMENT_NOT_ALLOWED')
  await HiringRequest.updateOne({ _id: request.id }, { $set: { status: 'pending' } })
  await assert.rejects(service.createHiringCheckout(user, request.id, { stripe }), (error) => error.code === 'HIRING_PAYMENT_NOT_ALLOWED')
  await HiringRequest.updateOne({ _id: request.id }, { $set: { status: 'rejected' } })
  await assert.rejects(service.createHiringCheckout(user, request.id, { stripe }), (error) => error.code === 'HIRING_PAYMENT_NOT_ALLOWED')
  await HiringRequest.updateOne({ _id: request.id }, { $set: { status: 'accepted' } })
  const pair = await Promise.all([service.createHiringCheckout(user, request.id, { stripe }), service.createHiringCheckout(user, request.id, { stripe })]); assert.equal(creates, 1); assert.equal(pair[0].transaction.id, pair[1].transaction.id)
  const transaction = await PaymentTransaction.findOne({ hiringRequestId: request.id }); assert.equal(transaction.amountMinor, 10000); assert.equal(transaction.currency, 'usd')
  const session = { id: transaction.stripeCheckoutSessionId, payment_status: 'paid', amount_total: 10000, currency: 'usd', payment_intent: 'pi_hire_1', metadata: { type: 'hiring_fee', transactionId: transaction.id, hiringRequestId: request.id, lawyerId: lawyer.id, lawyerProfileId: profile.id } }
  await assert.rejects(service.fulfillHiringSession({ ...session, currency: 'eur' }), (error) => error.code === 'INVALID_PAYMENT_SESSION')
  await assert.rejects(service.fulfillHiringSession({ ...session, id: 'cs_unrelated' }), (error) => error.code === 'INVALID_PAYMENT_SESSION')
  assert.equal((await HiringRequest.findById(request.id)).paymentStatus, 'checkout_created')
  assert.equal((await LawyerProfile.findById(profile.id)).paidHireCount, 0)
  await Promise.all([service.fulfillHiringSession(session), service.fulfillHiringSession(session)]); assert.equal((await HiringRequest.findById(request.id)).paymentStatus, 'paid'); assert.equal((await LawyerProfile.findById(profile.id)).paidHireCount, 1); assert.equal((await PaymentTransaction.findById(transaction.id)).status, 'paid')
  await LawyerProfile.updateOne({ _id: profile.id }, { $set: { paidHireCount: 0 } })
  await service.fulfillHiringSession(session)
  assert.equal((await LawyerProfile.findById(profile.id)).paidHireCount, 1)
  await service.resetExpiredCheckout({ id: session.id, metadata: session.metadata }); assert.equal((await HiringRequest.findById(request.id)).paymentStatus, 'paid'); assert.equal((await LawyerProfile.findById(profile.id)).paidHireCount, 1)
  await assert.rejects(service.createHiringCheckout(user, request.id, { stripe }), (error) => error.code === 'HIRING_PAYMENT_ALREADY_PAID')
})

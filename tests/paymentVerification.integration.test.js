import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))

test('lawyer verification payment state integration', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run payment integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = 'http://localhost:5173'
  process.env.STRIPE_SECRET_KEY = 'sk_test_payment_integration'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_payment_integration'
  process.env.LAWYER_PUBLISHING_FEE_CENTS = '5000'

  const [{ default: request }, mongoose, { default: app }, { User }, { LawyerProfile }, { PaymentTransaction }, paymentService, auth, { default: Stripe }] = await Promise.all([
    import('supertest'), import('mongoose'), import('../src/app.js'), import('../src/models/User.js'), import('../src/models/LawyerProfile.js'), import('../src/models/PaymentTransaction.js'), import('../src/services/paymentService.js'), import('../src/utils/auth.js'), import('stripe'),
  ])
  await mongoose.connect(testUri, { dbName: testDatabase })
  const label = `payment-${randomBytes(6).toString('hex')}`
  const emails = [`${label}-lawyer@legalease.test`, `${label}-other@legalease.test`, `${label}-failure@legalease.test`, `${label}-incomplete@legalease.test`]
  context.after(async () => {
    const users = await User.find({ email: { $in: emails } }).select('_id')
    const profileIds = await LawyerProfile.find({ userId: { $in: users.map((user) => user.id) } }).select('_id')
    await PaymentTransaction.deleteMany({ lawyerProfileId: { $in: profileIds.map((profile) => profile.id) } })
    await LawyerProfile.deleteMany({ userId: { $in: users.map((user) => user.id) } })
    await User.deleteMany({ email: { $in: emails } })
    await mongoose.disconnect()
  })

  const [lawyer, otherLawyer, failureLawyer, incompleteLawyer] = await User.create([
    { fullName: 'Payment Lawyer', email: emails[0], role: 'lawyer', status: 'active' },
    { fullName: 'Other Lawyer', email: emails[1], role: 'lawyer', status: 'active' },
    { fullName: 'Failure Lawyer', email: emails[2], role: 'lawyer', status: 'active' },
    { fullName: 'Incomplete Lawyer', email: emails[3], role: 'lawyer', status: 'active' },
  ])
  const profile = await LawyerProfile.create({
    userId: lawyer.id, professionalPhotoUrl: 'https://i.ibb.co/payment/portrait.png', specialization: 'Family Law', bio: 'Professional legal service description.', consultationFeeMinor: 9998, experienceYears: 1, licenseNumber: 'PAYMENT-001', availability: 'available', verificationStatus: 'unpaid', publicationStatus: 'draft',
  })

  let createdSessions = 0
  const fakeStripe = {
    checkout: { sessions: {
      retrieve: async (sessionId) => sessionId === 'cs_test_payment_1'
        ? { status: 'open', url: 'https://checkout.stripe.test/cs_test_payment_1' }
        : { status: 'expired', url: null },
      create: async (payload) => {
        createdSessions += 1
        assert.equal(payload.line_items[0].price_data.unit_amount, 5000)
        assert.equal(payload.line_items[0].price_data.currency, 'usd')
        return { id: 'cs_test_payment_1', url: 'https://checkout.stripe.test/cs_test_payment_1' }
      },
    } },
  }
  const [firstCheckout, secondCheckout] = await Promise.all([
    paymentService.createVerificationCheckout(lawyer, { stripe: fakeStripe }),
    paymentService.createVerificationCheckout(lawyer, { stripe: fakeStripe }),
  ])
  assert.equal(createdSessions, 1)
  assert.equal(firstCheckout.transaction.id, secondCheckout.transaction.id)
  assert.equal(firstCheckout.checkoutUrl, secondCheckout.checkoutUrl)
  assert.equal((await PaymentTransaction.countDocuments({ lawyerProfileId: profile.id, type: 'lawyer_verification' })), 1)
  assert.equal((await LawyerProfile.findById(profile.id)).verificationStatus, 'checkout_created')

  const transaction = await PaymentTransaction.findOne({ lawyerProfileId: profile.id, type: 'lawyer_verification' })
  const paidSession = {
    id: transaction.stripeCheckoutSessionId,
    amount_total: 5000,
    currency: 'usd',
    payment_status: 'paid',
    payment_intent: 'pi_test_payment_1',
    metadata: { transactionId: transaction.id, lawyerProfileId: profile.id, lawyerId: lawyer.id, type: 'lawyer_verification' },
  }
  await assert.rejects(paymentService.fulfillVerificationSession({ ...paidSession, amount_total: 1 }), (error) => error.code === 'INVALID_PAYMENT_SESSION')
  assert.equal((await PaymentTransaction.findById(transaction.id)).status, 'pending')
  await Promise.all([paymentService.fulfillVerificationSession(paidSession), paymentService.fulfillVerificationSession(paidSession)])
  const paidTransaction = await PaymentTransaction.findById(transaction.id)
  const paidProfile = await LawyerProfile.findById(profile.id)
  assert.equal(paidTransaction.status, 'paid')
  assert.equal(paidProfile.verificationStatus, 'paid')
  const paidAt = paidProfile.verificationPaidAt.getTime()
  await paymentService.resetExpiredCheckout({ id: paidSession.id, metadata: paidSession.metadata })
  assert.equal((await LawyerProfile.findById(profile.id)).verificationStatus, 'paid')
  assert.equal((await LawyerProfile.findById(profile.id)).verificationPaidAt.getTime(), paidAt)

  await assert.rejects(
    paymentService.createVerificationCheckout(lawyer, { stripe: fakeStripe }),
    (error) => error.code === 'VERIFICATION_ALREADY_PAID',
  )

  const lawyerToken = auth.createSessionToken(lawyer)
  const otherToken = auth.createSessionToken(otherLawyer)
  const cookie = `${process.env.COOKIE_NAME ?? 'legalease_session'}=${lawyerToken}`
  const otherCookie = `${process.env.COOKIE_NAME ?? 'legalease_session'}=${otherToken}`
  const origin = 'http://localhost:5173'
  assert.equal((await request(app).get(`/api/payments/${transaction.id}/status`).set('Cookie', otherCookie)).status, 404)
  assert.equal((await request(app).get('/api/payments/not-an-id/status').set('Cookie', cookie)).status, 404)
  assert.equal((await request(app).post('/api/payments/stripe/webhook').set('Stripe-Signature', 'invalid').set('Content-Type', 'application/json').send('{}')).status, 400)
  const webhookPayload = JSON.stringify({ id: 'evt_payment_replay', object: 'event', type: 'checkout.session.completed', data: { object: paidSession } })
  const webhookSignature = Stripe.webhooks.generateTestHeaderString({ payload: webhookPayload, secret: 'whsec_payment_integration' })
  assert.equal((await request(app).post('/api/payments/stripe/webhook').set('Stripe-Signature', webhookSignature).set('Content-Type', 'application/json').send(webhookPayload)).status, 200)
  assert.equal((await request(app).patch('/api/lawyers/me/publication').set('Cookie', cookie).set('Origin', origin).send({ publicationStatus: 'published' })).status, 200)
  assert.equal((await LawyerProfile.findById(profile.id)).publicationStatus, 'published')
  assert.equal((await request(app).patch('/api/lawyers/me/publication').set('Cookie', cookie).set('Origin', origin).send({ publicationStatus: 'unpublished' })).status, 200)
  assert.equal((await request(app).patch('/api/lawyers/me/publication').set('Cookie', cookie).set('Origin', origin).send({ publicationStatus: 'published' })).status, 200)

  await LawyerProfile.updateOne({ _id: profile.id }, { $set: { publicationStatus: 'suspended' } })
  assert.equal((await request(app).patch('/api/lawyers/me/publication').set('Cookie', cookie).set('Origin', origin).send({ publicationStatus: 'published' })).status, 403)

  const retryProfile = await LawyerProfile.create({ userId: otherLawyer.id, professionalPhotoUrl: 'https://i.ibb.co/payment/retry.png', specialization: 'Corporate Law', bio: 'Corporate legal service description.', consultationFeeMinor: 5000, experienceYears: 2, licenseNumber: 'PAYMENT-002', verificationStatus: 'checkout_created', publicationStatus: 'draft' })
  const retryTransaction = await PaymentTransaction.create({ type: 'lawyer_verification', payerId: otherLawyer.id, lawyerId: otherLawyer.id, lawyerProfileId: retryProfile.id, amountMinor: 5000, currency: 'usd', status: 'pending', stripeCheckoutSessionId: 'cs_test_expired' })
  await paymentService.resetExpiredCheckout({ id: 'cs_test_expired', metadata: { transactionId: retryTransaction.id } })
  assert.equal((await LawyerProfile.findById(retryProfile.id)).verificationStatus, 'unpaid')

  const failureProfile = await LawyerProfile.create({ userId: failureLawyer.id, professionalPhotoUrl: 'https://i.ibb.co/payment/failure.png', specialization: 'Employment Law', bio: 'Employment legal service description.', consultationFeeMinor: 5000, experienceYears: 2, licenseNumber: 'PAYMENT-003', verificationStatus: 'unpaid', publicationStatus: 'draft' })
  await assert.rejects(
    paymentService.createVerificationCheckout(failureLawyer, { stripe: { checkout: { sessions: { retrieve: async () => null, create: async () => { throw new Error('Stripe unavailable') } } } } }),
    /Stripe unavailable/,
  )
  assert.equal((await LawyerProfile.findById(failureProfile.id)).verificationStatus, 'unpaid')
  assert.equal((await PaymentTransaction.findOne({ lawyerProfileId: failureProfile.id })).checkoutCreating, false)

  const incompleteProfile = await LawyerProfile.create({ userId: incompleteLawyer.id, professionalPhotoUrl: '', specialization: '', bio: '', consultationFeeMinor: 0, experienceYears: 0, licenseNumber: '', verificationStatus: 'unpaid', publicationStatus: 'draft' })
  await assert.rejects(paymentService.createVerificationCheckout(incompleteLawyer, { stripe: fakeStripe }), (error) => error.code === 'PROFILE_INCOMPLETE')
  const incompleteToken = auth.createSessionToken(incompleteLawyer)
  assert.equal((await request(app).patch('/api/lawyers/me/publication').set('Cookie', `${process.env.COOKIE_NAME ?? 'legalease_session'}=${incompleteToken}`).set('Origin', origin).send({ publicationStatus: 'published' })).status, 403)
  assert.equal((await LawyerProfile.findById(incompleteProfile.id)).publicationStatus, 'draft')
})

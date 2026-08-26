import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('SSLCommerz checkout initiates, verifies via IPN, and books escrow commission exactly once', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin
  process.env.SSCOMMERZ_STORE_ID = 'legalease_test_store'
  process.env.SSCOMMERZ_STORE_PASSWORD = 'test_password'
  process.env.SSCOMMERZ_SANDBOX = 'true'

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { PaymentTransaction }, { resetStatsCache }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/PaymentTransaction.js'),
    import('../src/controllers/publicStatsController.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await PaymentTransaction.init()
  resetStatsCache()

  const suffix = randomBytes(6).toString('hex')
  const emails = [`ssc-lawyer.${suffix}`, `ssc-client.${suffix}`, `ssc-other.${suffix}`].map((local) => `${local}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })

  let validatorResponse = { status: 'VALID' }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('gwprocess')) {
      return { json: async () => ({ GatewayPageURL: 'https://sandbox.sslcommerz.com/gwprocess/testsession' }) }
    }
    if (String(url).includes('validator')) {
      return { json: async () => validatorResponse }
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  context.after(async () => {
    globalThis.fetch = originalFetch
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await PaymentTransaction.deleteMany({})
    resetStatsCache()
    await mongoose.disconnect()
  })

  const [lawyer, client, other] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `SSC ${email.slice(4, 10)}`, email, passwordHash, role: email === emails[0] ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/ssc-portrait.png',
    specialization: 'Corporate Law',
    bio: 'Company formation and compliance.',
    consultationFeeMinor: 22000,
    experienceYears: 14,
    licenseNumber: 'BAR-SSC-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
    availability: 'available',
  })

  const engagement = await HiringRequest.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    specializationSnapshot: 'Corporate Law',
    feeMinorSnapshot: 22000,
    currency: 'USD',
    status: 'accepted',
    paymentStatus: 'unpaid',
  })

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }

  const clientCookie = decodeURIComponent((await login(client)).headers['set-cookie'][0].split(';')[0])

  const unauth = await request(app).post(`/api/payments/hiring/${engagement.id}/sslcommerz/initiate`).set('Origin', origin)
  assert.equal(unauth.status, 401)

  const otherCookie = decodeURIComponent((await login(other)).headers['set-cookie'][0].split(';')[0])
  const notOwner = await request(app).post(`/api/payments/hiring/${engagement.id}/sslcommerz/initiate`).set('Origin', origin).set('Cookie', otherCookie)
  assert.equal(notOwner.status, 404)

  const initiated = await request(app)
    .post(`/api/payments/hiring/${engagement.id}/sslcommerz/initiate`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
  assert.equal(initiated.status, 201)
  assert.match(initiated.body.data.redirectUrl, /gwprocess/)

  const storedTxn = await PaymentTransaction.findOne({ hiringRequestId: engagement._id, type: 'hiring_fee' })
  assert.equal(storedTxn.gateway, 'sslcommerz')
  assert.ok(storedTxn.gatewayTranId.startsWith('LE-'))
  assert.equal(storedTxn.status, 'pending')
  assert.equal(storedTxn.escrowStatus, null)
  assert.equal(storedTxn.platformCommissionMinor, null)
  assert.equal(storedTxn.amountMinor, 22000)

  // Gateway lock protects against mixed-gateway double payment.
  await PaymentTransaction.updateOne(
    { _id: storedTxn._id },
    { $set: { gateway: 'stripe', stripeCheckoutSessionId: 'cs_test_locked' } },
  )
  const locked = await request(app)
    .post(`/api/payments/hiring/${engagement.id}/sslcommerz/initiate`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
  assert.equal(locked.status, 409)
  assert.equal(locked.body.error.code, 'PAYMENT_GATEWAY_LOCKED')
  await PaymentTransaction.updateOne(
    { _id: storedTxn._id },
    { $set: { gateway: 'sslcommerz' }, $unset: { stripeCheckoutSessionId: 1 } },
  )

  const ipnBase = { tran_id: storedTxn.gatewayTranId, val_id: `VAL-${randomBytes(6).toString('hex')}`, currency: 'BDT', status: 'VALID' }

  const tampered = await request(app)
    .post('/api/payments/sslcommerz/ipn')
    .type('form')
    .send({ ...ipnBase, amount: '1.00' })
  assert.equal(tampered.status, 400)
  assert.equal(tampered.body.error.code, 'INVALID_IPN')

  const validIpn = await request(app)
    .post('/api/payments/sslcommerz/ipn')
    .type('form')
    .send({ ...ipnBase, amount: '220.00' })
  assert.equal(validIpn.status, 200)

  const paidTxn = await PaymentTransaction.findById(storedTxn._id)
  assert.equal(paidTxn.status, 'paid')
  assert.equal(paidTxn.escrowStatus, 'held')
  assert.equal(paidTxn.platformCommissionMinor, 3300)
  assert.equal(paidTxn.lawyerPayoutMinor, 18700)
  assert.equal(paidTxn.gatewayValId, ipnBase.val_id)

  const paidRequest = await HiringRequest.findById(engagement._id)
  assert.equal(paidRequest.paymentStatus, 'paid')

  const profileAfter = await LawyerProfile.findById(profile.id)
  assert.equal(profileAfter.paidHireCount, 1)

  const replay = await request(app)
    .post('/api/payments/sslcommerz/ipn')
    .type('form')
    .send({ ...ipnBase, amount: '220.00' })
  assert.equal(replay.status, 200)
  const afterReplay = await PaymentTransaction.findById(storedTxn._id)
  assert.equal(afterReplay.status, 'paid')
  assert.equal(afterReplay.platformCommissionMinor, 3300)
  const profileAfterReplay = await LawyerProfile.findById(profile.id)
  assert.equal(profileAfterReplay.paidHireCount, 1)

  const statusView = await request(app).get(`/api/payments/${storedTxn._id}/status`).set('Cookie', clientCookie)
  assert.equal(statusView.body.data.gateway, 'sslcommerz')
  assert.equal(statusView.body.data.escrowStatus, 'held')
})

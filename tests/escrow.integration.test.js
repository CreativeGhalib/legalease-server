import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'
const DAY = 24 * 60 * 60 * 1000

test('escrow releases via client confirmation or 7-day sweep exactly once; verification txns untouched', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { PaymentTransaction }, { Notification }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/PaymentTransaction.js'),
    import('../src/models/Notification.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await PaymentTransaction.init()
  await Notification.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['esc-lawyer', 'esc-client-a', 'esc-client-b'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await PaymentTransaction.deleteMany({})
    await Notification.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, clientA, clientB] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Escrow ${email.split('.')[0]}`, email, passwordHash, role: email === emails[0] ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/esc-portrait.png',
    specialization: 'Corporate Law',
    bio: 'Contracts.',
    consultationFeeMinor: 20000,
    experienceYears: 8,
    licenseNumber: 'BAR-ESC-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function seedEngagement(client, paidDaysAgo) {
    return HiringRequest.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Corporate Law',
      feeMinorSnapshot: 20000,
      currency: 'USD',
      status: 'accepted',
      paymentStatus: 'paid',
      decisionAt: new Date(),
      paidAt: new Date(Date.now() - paidDaysAgo * DAY),
    })
  }

  async function seedPaidFeeTxn(engagement, paidDaysAgo) {
    return PaymentTransaction.create({
      type: 'hiring_fee',
      payerId: engagement.clientId,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      hiringRequestId: engagement._id,
      stripeCheckoutSessionId: `cs_test_${randomBytes(10).toString('hex')}`,
      amountMinor: 20000,
      currency: 'usd',
      status: 'paid',
      escrowStatus: 'held',
      paidAt: new Date(Date.now() - paidDaysAgo * DAY),
    })
  }

  const freshEngagement = await seedEngagement(clientA, 0)
  const freshTxn = await seedPaidFeeTxn(freshEngagement, 0)
  const matureEngagement = await seedEngagement(clientB, 8)
  const matureTxn = await seedPaidFeeTxn(matureEngagement, 8)

  // Verification-type transaction must be invisible to the sweep.
  await PaymentTransaction.create({
    type: 'lawyer_verification',
    payerId: lawyer.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    stripeCheckoutSessionId: `cs_test_verify_${randomBytes(8).toString('hex')}`,
    amountMinor: 5000,
    currency: 'usd',
    status: 'paid',
    escrowStatus: 'held',
    paidAt: new Date(Date.now() - 30 * DAY),
  })

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }
  const cookieA = decodeURIComponent((await login(clientA)).headers['set-cookie'][0].split(';')[0])
  const cookieB = decodeURIComponent((await login(clientB)).headers['set-cookie'][0].split(';')[0])
  const cookieLawyer = decodeURIComponent((await login(lawyer)).headers['set-cookie'][0].split(';')[0])

  const unauth = await request(app)
    .post(`/api/cases/${freshEngagement.id}/confirm-completion`)
    .set('Origin', origin)
  assert.equal(unauth.status, 401)

  const outsiderCookie = cookieB
  const outsiderConfirm = await request(app)
    .post(`/api/cases/${freshEngagement.id}/confirm-completion`)
    .set('Origin', origin)
    .set('Cookie', outsiderCookie)
  assert.equal(outsiderConfirm.status, 404)
  assert.equal(outsiderConfirm.body.error.code, 'CASE_NOT_FOUND')

  const tooEarly = await request(app)
    .post(`/api/cases/${freshEngagement.id}/confirm-completion`)
    .set('Origin', origin)
    .set('Cookie', cookieA)
  assert.equal(tooEarly.status, 409)
  assert.equal(tooEarly.body.error.code, 'CONFIRM_TOO_EARLY')

  // Reading payments sweeps mature escrow transactions automatically.
  await request(app).get('/api/payments/mine').set('Cookie', cookieB)
  let heldCount = await PaymentTransaction.countDocuments({ escrowStatus: 'held', type: 'hiring_fee' })
  assert.equal(heldCount, 1)

  // Client A confirms after backdating past the grace period.
  await HiringRequest.updateOne({ _id: freshEngagement._id }, { $set: {} })
  await PaymentTransaction.updateOne({ _id: freshTxn._id }, { $set: { paidAt: new Date(Date.now() - 2 * DAY) } })

  const confirmed = await request(app)
    .post(`/api/cases/${freshEngagement.id}/confirm-completion`)
    .set('Origin', origin)
    .set('Cookie', cookieA)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.data.escrowStatus, 'released')
  assert.equal(confirmed.body.data.releaseReason, 'client_confirmed')

  const idempotent = await request(app)
    .post(`/api/cases/${freshEngagement.id}/confirm-completion`)
    .set('Origin', origin)
    .set('Cookie', cookieA)
  assert.equal(idempotent.status, 200)
  assert.equal(idempotent.body.data.escrowStatus, 'released')

  const lawyerReleaseNotes = await Notification.countDocuments({
    userId: lawyer._id,
    type: 'payment',
    title: /Funds released/i,
  })
  assert.equal(lawyerReleaseNotes, 1)

  // Mature txn auto-releases on the client B read path.
  await request(app).get('/api/payments/mine').set('Cookie', cookieB)
  const sweptTxn = await PaymentTransaction.findById(matureTxn._id)
  assert.equal(sweptTxn.escrowStatus, 'released')
  assert.equal(sweptTxn.releaseReason, 'auto_7d')

  // Second sweep is a no-op — already released.
  await request(app).get('/api/payments/mine').set('Cookie', cookieB)
  const stillReleased = await PaymentTransaction.findById(matureTxn._id)
  assert.equal(stillReleased.escrowStatus, 'released')

  const lawyerAutoNotes = await Notification.countDocuments({
    userId: lawyer._id,
    title: 'Escrow funds auto-released',
  })
  assert.equal(lawyerAutoNotes, 1)

  // Verification transaction untouched by sweeps.
  const verificationTxn = await PaymentTransaction.findOne({ type: 'lawyer_verification' })
  assert.equal(verificationTxn.escrowStatus, 'held')
  assert.equal(verificationTxn.releaseReason, null)

  // Status DTO exposes the release fields to the payer.
  const statusView = await request(app).get(`/api/payments/${matureTxn._id}/status`).set('Cookie', cookieB)
  assert.equal(statusView.body.data.escrowStatus, 'released')
  assert.equal(statusView.body.data.releaseReason, 'auto_7d')
  assert.ok(statusView.body.data.releasedAt)

  // Mine list exposes the same fields per row.
  const mineList = await request(app).get('/api/payments/mine').set('Cookie', cookieB)
  const mineRow = mineList.body.data.items.find((item) => item.id === String(matureTxn._id))
  assert.equal(mineRow.escrowStatus, 'released')
  assert.equal(mineRow.releaseReason, 'auto_7d')
})

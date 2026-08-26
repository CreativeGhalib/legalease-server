import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('my-transactions expose invoice-safe party names scoped to the viewer', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { PaymentTransaction }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/PaymentTransaction.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await PaymentTransaction.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = [`invoice-lawyer.${suffix}`, `invoice-client.${suffix}`].map((local) => `${local}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await PaymentTransaction.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, client] = await Promise.all(emails.map((email) =>
    User.create({ fullName: email.includes('lawyer') ? 'Invoice Lawyer' : 'Invoice Client', email, passwordHash, role: email.includes('lawyer') ? 'lawyer' : 'user', providers: ['local'] }),
  ))
  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/invoice-portrait.png',
    specialization: 'Property Law',
    bio: 'Land disputes.',
    consultationFeeMinor: 22000,
    experienceYears: 5,
    licenseNumber: 'BAR-INV-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })
  const engagement = await HiringRequest.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    specializationSnapshot: 'Property Law',
    feeMinorSnapshot: 22000,
    currency: 'USD',
    status: 'accepted',
    paymentStatus: 'paid',
    decisionAt: new Date(),
    paidAt: new Date(),
  })
  const transaction = await PaymentTransaction.create({
    type: 'hiring_fee',
    payerId: client.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    hiringRequestId: engagement.id,
    stripeCheckoutSessionId: `cs_test_${randomBytes(12).toString('hex')}`,
    amountMinor: 22000,
    currency: 'usd',
    status: 'paid',
    paidAt: new Date(),
  })

  const unauth = await request(app).get('/api/payments/mine')
  assert.equal(unauth.status, 401)

  const clientLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: emails[1], password: sharedPassword })
  assert.equal(clientLogin.status, 200)
  const clientCookie = decodeURIComponent(clientLogin.headers['set-cookie'][0].split(';')[0])

  const clientView = await request(app).get('/api/payments/mine').set('Cookie', clientCookie)
  assert.equal(clientView.status, 200)
  const clientItem = clientView.body.data.items.find((item) => item.id === String(transaction._id))
  assert.ok(clientItem)
  assert.equal(clientItem.payerName, 'Invoice Client')
  assert.equal(clientItem.lawyerName, 'Invoice Lawyer')
  assert.equal(clientItem.engagementSpecialization, 'Property Law')

  const lawyerCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: emails[0], password: sharedPassword })).headers['set-cookie'][0].split(';')[0])
  const lawyerView = await request(app).get('/api/payments/mine').set('Cookie', lawyerCookie)
  const lawyerItem = lawyerView.body.data.items.find((item) => item.id === String(transaction._id))
  assert.ok(lawyerItem)
  assert.equal(lawyerItem.payerName, 'Invoice Client')
})

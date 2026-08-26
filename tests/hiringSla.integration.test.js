import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('48-hour SLA lazily expires due requests, grandfathered rows stay decidable', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = [`sla-lawyer.${suffix}`, `sla-old.${suffix}`, `sla-new.${suffix}`].map((local) => `${local}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, clientOld, clientNew] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `SLA Fixture ${email.slice(4, 8)}`, email, passwordHash, role: email === emails[0] ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/sla-portrait.png',
    specialization: 'Civil Litigation',
    bio: 'Dispute resolution practice.',
    consultationFeeMinor: 15000,
    experienceYears: 6,
    licenseNumber: 'BAR-SLA-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function seedRequest(client, expiresAt) {
    return HiringRequest.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Civil Litigation',
      feeMinorSnapshot: 15000,
      currency: 'USD',
      status: 'pending',
      paymentStatus: 'unpaid',
      expiresAt,
    })
  }

  const grandfathered = await seedRequest(clientOld, null)
  const dueRequest = await seedRequest(clientNew, new Date(Date.now() - 60_000))

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }

  const unauthList = await request(app).get('/api/hiring-requests/mine')
  assert.equal(unauthList.status, 401)

  const oldClientCookie = decodeURIComponent((await login(clientOld)).headers['set-cookie'][0].split(';')[0])
  const oldList = await request(app).get('/api/hiring-requests/mine').set('Cookie', oldClientCookie)
  assert.equal(oldList.status, 200)
  const grandfatheredRow = oldList.body.data.items.find((item) => item.id === String(grandfathered.id))
  assert.equal(grandfatheredRow.status, 'pending')

  const newClientCookie = decodeURIComponent((await login(clientNew)).headers['set-cookie'][0].split(';')[0])
  const newList = await request(app).get('/api/hiring-requests/mine').set('Cookie', newClientCookie)
  assert.equal(newList.status, 200)
  const expiredRow = newList.body.data.items.find((item) => item.id === String(dueRequest.id))
  assert.equal(expiredRow.status, 'expired')

  const storedDue = await HiringRequest.findById(dueRequest.id)
  assert.equal(storedDue.status, 'expired')

  const lawyerCookie = decodeURIComponent((await login(lawyer)).headers['set-cookie'][0].split(';')[0])
  const decideExpired = await request(app)
    .patch(`/api/hiring-requests/${dueRequest.id}/decision`)
    .set('Origin', origin)
    .set('Cookie', lawyerCookie)
    .send({ decision: 'accepted' })
  assert.equal(decideExpired.status, 409)
  assert.equal(decideExpired.body.error.code, 'HIRING_REQUEST_EXPIRED')

  const decideGrandfathered = await request(app)
    .patch(`/api/hiring-requests/${grandfathered.id}/decision`)
    .set('Origin', origin)
    .set('Cookie', lawyerCookie)
    .send({ decision: 'accepted' })
  assert.equal(decideGrandfathered.status, 200)
  assert.equal(decideGrandfathered.body.data.request.status, 'accepted')

  const rereadOldList = await request(app).get('/api/hiring-requests/mine').set('Cookie', oldClientCookie)
  assert.equal(rereadOldList.body.data.items.find((item) => item.id === String(grandfathered.id)).status, 'accepted')
})

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('public stats endpoint serves cached marketplace counts with graceful zero mode', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { resetStatsCache }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/controllers/publicStatsController.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  resetStatsCache()
  context.after(async () => {
    await User.deleteMany({ email: { $in: fixtureEmails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    resetStatsCache()
    await mongoose.disconnect()
  })

  const suffix = randomBytes(6).toString('hex')
  const fixtureEmails = [`stats-lawyer.${suffix}@legalease.test`, `stats-user.${suffix}@legalease.test`, `stats-client.${suffix}@legalease.test`, `stats-client2.${suffix}@legalease.test`]
  const [lawyerEmail] = fixtureEmails
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)

  const lawyer = await User.create({ fullName: 'Stats Lawyer', email: lawyerEmail, passwordHash, role: 'lawyer', providers: ['local'] })
  await User.create({ fullName: 'Stats Member', email: fixtureEmails[1], passwordHash, role: 'user', providers: ['local'] })
  const client = await User.create({ fullName: 'Stats Client', email: fixtureEmails[2], passwordHash, role: 'user', providers: ['local'] })
  const clientTwo = await User.create({ fullName: 'Stats Client Two', email: fixtureEmails[3], passwordHash, role: 'user', providers: ['local'] })

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/stats-portrait.png',
    specialization: 'Family Law',
    bio: 'Mediation and settlement focus.',
    consultationFeeMinor: 18000,
    experienceYears: 11,
    licenseNumber: 'BAR-STATS-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })
  await LawyerProfile.create({ userId: lawyer.id, specialization: 'Hidden', consultationFeeMinor: 1000, publicationStatus: 'draft' })

  await HiringRequest.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    specializationSnapshot: 'Family Law',
    feeMinorSnapshot: 18000,
    currency: 'USD',
    status: 'accepted',
    paymentStatus: 'paid',
    decisionAt: new Date(),
    paidAt: new Date(),
  })

  const first = await request(app).get('/api/stats/public')
  assert.equal(first.status, 200)
  assert.equal(first.body.success, true)
  assert.equal(first.body.data.lawyerCount, 1)
  assert.equal(first.body.data.paidHireCount, 1)
  assert.equal(first.body.data.userCount, 3)
  assert.equal(first.body.data.recentLawyers.length, 1)
  assert.equal(first.body.data.recentLawyers[0].fullName, 'Stats Lawyer')
  assert.equal(first.body.data.recentLawyers[0].tier, 'bronze')

  await HiringRequest.create({
    clientId: clientTwo.id,
    lawyerId: lawyer.id,
    lawyerProfileId: profile.id,
    specializationSnapshot: 'Family Law',
    feeMinorSnapshot: 18000,
    currency: 'USD',
    status: 'accepted',
    paymentStatus: 'paid',
    decisionAt: new Date(),
    paidAt: new Date(),
  })

  const second = await request(app).get('/api/stats/public')
  assert.equal(second.status, 200)
  assert.equal(second.body.data.paidHireCount, 1)

  resetStatsCache()
  const third = await request(app).get('/api/stats/public')
  assert.equal(third.body.data.paidHireCount, 2)
})

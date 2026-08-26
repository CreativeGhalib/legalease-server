import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('intake qualification returns category, urgency and eligible recommendations', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['intake-lawyer', 'intake-other-lawyer'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })

  const [criminalLawyer, familyLawyer] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Intake ${email.split('.')[0]}`, email, passwordHash, role: 'lawyer', providers: ['local'] }),
  ))

  async function seedProfile(user, specialization, publicationStatus = 'published') {
    return LawyerProfile.create({
      userId: user.id,
      professionalPhotoUrl: 'https://i.ibb.co/intake-portrait.png',
      specialization,
      bio: 'Focused practice.',
      consultationFeeMinor: 15000,
      experienceYears: 6,
      licenseNumber: `BAR-INTAKE-${specialization.length}`,
      verificationStatus: 'paid',
      publicationStatus,
    })
  }

  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await mongoose.disconnect()
  })

  await seedProfile(criminalLawyer, 'Criminal Law')
  await seedProfile(familyLawyer, 'Family Law', 'draft')

  const invalidBody = await request(app)
    .post('/api/intake/qualify')
    .send({ message: 'too short' })
  assert.equal(invalidBody.status, 400)
  assert.equal(invalidBody.body.error.code, 'VALIDATION_ERROR')

  const qualified = await request(app)
    .post('/api/intake/qualify')
    .send({ message: 'The police arrested my brother during a protest and we need bail immediately.' })
  assert.equal(qualified.status, 200)
  assert.equal(qualified.body.data.category, 'Criminal Law')
  assert.equal(qualified.body.data.urgency, 'urgent')
  assert.ok(qualified.body.data.recommendedLawyers.length >= 1)
  assert.equal(qualified.body.data.recommendedLawyers[0].specialization, 'Criminal Law')

  const unmatchedCategory = await request(app)
    .post('/api/intake/qualify')
    .send({ message: 'I have an immigration visa question about work permits.' })
  assert.equal(unmatchedCategory.status, 200)
  assert.deepEqual(unmatchedCategory.body.data.recommendedLawyers, [])

  // Rate limit: 10 per 15 minutes per IP. Three requests sent so far; push past the ceiling.
  let sawLimited = false
  for (let attempt = 0; attempt < 9 && !sawLimited; attempt += 1) {
    const probe = await request(app)
      .post('/api/intake/qualify')
      .send({ message: `General legal question number ${attempt} about property paperwork.` })
    if (probe.status === 429) {
      sawLimited = true
      assert.equal(probe.body.error.code, 'INTAKE_RATE_LIMITED')
    }
  }
  assert.ok(sawLimited, 'expected the intake rate limiter to engage after ten requests')
})

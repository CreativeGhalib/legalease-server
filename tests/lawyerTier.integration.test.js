import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('admin tier management updates non-deleted lawyer profiles and exposes tier publicly', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
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
  const adminEmail = `tier-admin.${suffix}@legalease.test`
  const lawyerEmail = `tier-lawyer.${suffix}@legalease.test`
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: [adminEmail, lawyerEmail] } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: [adminEmail, lawyerEmail] } })
    await LawyerProfile.deleteMany({})
    await mongoose.disconnect()
  })

  const admin = await User.create({ fullName: 'Tier Admin', email: adminEmail, passwordHash, role: 'admin', providers: ['local'] })
  const lawyer = await User.create({ fullName: 'Tier Lawyer', email: lawyerEmail, passwordHash, role: 'lawyer', providers: ['local'] })
  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/tier-portrait.png',
    specialization: 'Criminal Law',
    bio: 'Trial practice focus.',
    consultationFeeMinor: 25000,
    experienceYears: 9,
    licenseNumber: 'BAR-TIER-001',
    barAssociationBranch: 'Dhaka Bar Association',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function patchTier(tierBody) {
    return request(app).patch(`/api/admin/lawyers/${profile.id}/tier`).set('Origin', origin)
  }

  const unauth = await patchTier().send({ tier: 'silver' })
  assert.equal(unauth.status, 401)
  assert.equal(unauth.body.error.code, 'AUTHENTICATION_REQUIRED')

  const adminLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: adminEmail, password: sharedPassword })
  assert.equal(adminLogin.status, 200)
  const adminCookie = decodeURIComponent(adminLogin.headers['set-cookie'][0].split(';')[0])

  const lawyerLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: lawyerEmail, password: sharedPassword })
  assert.equal(lawyerLogin.status, 200)
  const lawyerCookie = decodeURIComponent(lawyerLogin.headers['set-cookie'][0].split(';')[0])

  const forbidden = await request(app).patch(`/api/admin/lawyers/${profile.id}/tier`).set('Origin', origin).set('Cookie', lawyerCookie).send({ tier: 'gold' })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.body.error.code, 'AUTHORIZATION_DENIED')

  const invalidEnum = await request(app).patch(`/api/admin/lawyers/${profile.id}/tier`).set('Origin', origin).set('Cookie', adminCookie).send({ tier: 'platinum' })
  assert.equal(invalidEnum.status, 400)
  assert.equal(invalidEnum.body.error.code, 'VALIDATION_ERROR')

  const promote = await request(app).patch(`/api/admin/lawyers/${profile.id}/tier`).set('Origin', origin).set('Cookie', adminCookie).send({ tier: 'gold' })
  assert.equal(promote.status, 200)
  assert.equal(promote.body.data.tier, 'gold')
  const stored = await LawyerProfile.findById(profile.id)
  assert.equal(stored.tier, 'gold')

  const publicView = await request(app).get(`/api/lawyers/${profile.id}`)
  assert.equal(publicView.status, 200)
  assert.equal(publicView.body.data.lawyer.tier, 'gold')
  assert.equal(publicView.body.data.lawyer.barAssociationBranch, 'Dhaka Bar Association')

  profile.publicationStatus = 'deleted'
  profile.deletedAt = new Date()
  profile.deletedByRole = 'lawyer'
  await profile.save()
  const deletedProfile = await request(app).patch(`/api/admin/lawyers/${profile.id}/tier`).set('Origin', origin).set('Cookie', adminCookie).send({ tier: 'silver' })
  assert.equal(deletedProfile.status, 404)
  assert.equal(deletedProfile.body.error.code, 'LAWYER_PROFILE_NOT_FOUND')
})

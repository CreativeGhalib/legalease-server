import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('admin deactivation revokes existing sessions even after the account is reactivated', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { createSessionToken }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/utils/auth.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()

  const suffix = randomBytes(6).toString('hex')
  const adminEmail = `lockout-admin.${suffix}@legalease.test`
  const victimEmail = `deactivation-victim.${suffix}@legalease.test`
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: [adminEmail, victimEmail] } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: [adminEmail, victimEmail] } })
    await mongoose.disconnect()
  })

  const admin = await User.create({ fullName: 'Deactivation Admin', email: adminEmail, passwordHash, role: 'admin', providers: ['local'] })
  const victim = await User.create({ fullName: 'Deactivation Victim', email: victimEmail, passwordHash, role: 'user', providers: ['local'] })

  const adminLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: adminEmail, password: sharedPassword })
  assert.equal(adminLogin.status, 200)
  const adminCookie = decodeURIComponent(adminLogin.headers['set-cookie'][0].split(';')[0])

  const preDeactivationToken = createSessionToken({ id: victim.id, tokenVersion: victim.tokenVersion })
  const preDeactivationCookie = `${process.env.COOKIE_NAME ?? 'legalease_session'}=${preDeactivationToken}`

  const preUse = await request(app).get('/api/auth/me').set('Cookie', preDeactivationCookie)
  assert.equal(preUse.status, 200)

  const deactivate = await request(app)
    .patch(`/api/admin/users/${victim.id}/status`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ status: 'deactivated' })
  assert.equal(deactivate.status, 200)
  assert.equal(deactivate.body.data.user.status, 'deactivated')

  const storedAfterDeactivation = await User.findById(victim.id)
  assert.equal(storedAfterDeactivation.tokenVersion, victim.tokenVersion + 1)

  const rejectedWhileInactive = await request(app).get('/api/auth/me').set('Cookie', preDeactivationCookie)
  assert.equal(rejectedWhileInactive.status, 401)

  const reactivate = await request(app)
    .patch(`/api/admin/users/${victim.id}/status`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ status: 'active' })
  assert.equal(reactivate.status, 200)

  const staleReplay = await request(app).get('/api/auth/me').set('Cookie', preDeactivationCookie)
  assert.equal(staleReplay.status, 401)
  assert.equal(staleReplay.body.error.code, 'AUTHENTICATION_REQUIRED')

  const freshLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: victimEmail, password: sharedPassword })
  assert.equal(freshLogin.status, 200)
})

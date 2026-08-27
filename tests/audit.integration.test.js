import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('admin and money actions persist queryable audit entries', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { AuditLog }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/AuditLog.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await AuditLog.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['aud-admin', 'aud-lawyer'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await AuditLog.deleteMany({})
    await mongoose.disconnect()
  })

  const [admin, lawyer] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Audit ${email.split('.')[0]}`, email, passwordHash, role: email.startsWith('aud-admin') ? 'admin' : 'lawyer', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    specialization: 'Corporate Law',
    consultationFeeMinor: 25000,
    licenseNumber: 'BAR-AUD-001',
    tier: 'bronze',
  })

  async function cookieFor(user) {
    const response = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
    assert.equal(response.status, 200)
    return decodeURIComponent(response.headers['set-cookie'][0].split(';')[0])
  }

  const unauthList = await request(app).get('/api/admin/audit-logs')
  assert.equal(unauthList.status, 401)

  const adminCookie = await cookieFor(admin)
  let lawyerCookie = await cookieFor(lawyer)

  // Tier change writes an entry.
  const tierChange = await request(app)
    .patch(`/api/admin/lawyers/${profile.id}/tier`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ tier: 'silver' })
  assert.equal(tierChange.status, 200)

  // Deactivation writes an entry.
  const deactivate = await request(app)
    .patch(`/api/admin/users/${lawyer.id}/status`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ status: 'deactivated' })
  assert.equal(deactivate.status, 200)

  // Reactivate so moderation can run on an active account.
  await request(app)
    .patch(`/api/admin/users/${lawyer.id}/status`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ status: 'active' })
  lawyerCookie = await cookieFor(lawyer)

  const moderate = await request(app)
    .patch(`/api/admin/lawyers/${profile.id}/publication`)
    .set('Origin', origin)
    .set('Cookie', adminCookie)
    .send({ action: 'unpublish' })
  assert.equal(moderate.status, 200)

  const forbidden = await request(app).get('/api/admin/audit-logs').set('Cookie', lawyerCookie)
  assert.equal(forbidden.status, 403)

  const filtered = await request(app)
    .get('/api/admin/audit-logs')
    .query({ action: 'tier.change', limit: 10 })
    .set('Cookie', adminCookie)
  assert.equal(filtered.status, 200)
  assert.equal(filtered.body.data.items.length, 1)
  assert.equal(filtered.body.data.items[0].action, 'tier.change')
  assert.equal(filtered.body.data.items[0].meta.to, 'silver')

  const all = await request(app).get('/api/admin/audit-logs').set('Cookie', adminCookie)
  const actions = all.body.data.items.map((item) => item.action)
  assert.ok(actions.includes('user.deactivate'))
  assert.ok(actions.includes('listing.unpublish'))
})

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))

test('allowlisted current account profile integration', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run account-profile integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = 'http://localhost:5173'
  const [{ default: request }, mongoose, { default: app }, { User }] = await Promise.all([
    import('supertest'), import('mongoose'), import('../src/app.js'), import('../src/models/User.js'),
  ])
  await mongoose.connect(testUri, { dbName: testDatabase })
  const label = `account-${randomBytes(6).toString('hex')}`
  const emails = [`${label}-one@legalease.test`, `${label}-two@legalease.test`]
  context.after(async () => { await User.deleteMany({ email: { $in: emails } }); await mongoose.disconnect() })
  const password = randomBytes(24).toString('base64url')
  const first = request.agent(app)
  const second = request.agent(app)
  assert.equal((await first.post('/api/auth/register').set('Origin', 'http://localhost:5173').send({ fullName: 'Account Profile User', email: emails[0], password, confirmPassword: password, role: 'user' })).status, 201)
  assert.equal((await second.post('/api/auth/register').set('Origin', 'http://localhost:5173').send({ fullName: 'Other Account User', email: emails[1], password, confirmPassword: password, role: 'user' })).status, 201)
  assert.equal((await request(app).get('/api/users/me')).status, 401)
  const before = await first.get('/api/users/me')
  assert.equal(before.status, 200)
  assert.equal(before.body.data.user.passwordHash, undefined)
  const update = await first.patch('/api/users/me').set('Origin', 'http://localhost:5173').send({ fullName: '  Updated Account User  ', profileImageUrl: 'https://i.ibb.co/account/profile.png' })
  assert.equal(update.status, 200)
  assert.equal(update.body.data.user.fullName, 'Updated Account User')
  assert.equal(update.body.data.user.profileImageUrl, 'https://i.ibb.co/account/profile.png')
  assert.equal((await first.patch('/api/users/me').set('Origin', 'http://localhost:5173').send({ role: 'admin' })).status, 400)
  assert.equal((await first.patch('/api/users/me').set('Origin', 'http://localhost:5173').send({ status: 'deactivated' })).status, 400)
  assert.equal((await first.patch('/api/users/me').set('Origin', 'http://localhost:5173').send({ email: 'changed@legalease.test' })).status, 400)
  assert.equal((await first.patch('/api/users/me').set('Origin', 'http://localhost:5173').send({ profileImageUrl: 'https://example.test/untrusted.png' })).status, 400)
  assert.equal((await second.get('/api/users/me')).body.data.user.fullName, 'Other Account User')
  const persisted = await first.get('/api/users/me')
  assert.equal(persisted.body.data.user.fullName, 'Updated Account User')
  assert.equal(persisted.body.data.user.profileImageUrl, 'https://i.ibb.co/account/profile.png')
})

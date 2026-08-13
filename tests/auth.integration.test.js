import assert from 'node:assert/strict'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))

test('email/password authentication integration', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters'
  process.env.CLIENT_ORIGINS = 'http://localhost:5173'

  const [{ default: request }, mongoose, { default: app }, { User }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('../src/app.js'),
    import('../src/models/User.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await User.deleteMany({ email: 'auth.integration@legalease.test' })
  context.after(async () => {
    await User.deleteMany({ email: 'auth.integration@legalease.test' })
    await mongoose.disconnect()
  })

  const agent = request.agent(app)
  const registration = await agent.post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({
      fullName: 'Integration User',
      email: ' AUTH.INTEGRATION@LegalEase.Test ',
      password: 'Secure-test-password-123!',
      confirmPassword: 'Secure-test-password-123!',
      role: 'user',
    })

  assert.equal(registration.status, 201)
  assert.equal(registration.body.data.user.email, 'auth.integration@legalease.test')
  assert.equal(registration.body.data.user.passwordHash, undefined)
  assert.match(registration.headers['set-cookie'][0], /HttpOnly/)
  assert.match(registration.headers['set-cookie'][0], /Max-Age=604800/)

  const duplicate = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Duplicate User', email: 'auth.integration@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'Secure-test-password-123!', role: 'user' })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'EMAIL_ALREADY_REGISTERED')

  const adminRole = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Bad Role', email: 'admin-denied@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'Secure-test-password-123!', role: 'admin' })
  assert.equal(adminRole.status, 400)

  const invalidLogin = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'auth.integration@legalease.test', password: 'wrong-password' })
  assert.equal(invalidLogin.status, 401)
  assert.equal(invalidLogin.body.error.code, 'INVALID_CREDENTIALS')

  const currentUser = await agent.get('/api/auth/me')
  assert.equal(currentUser.status, 200)
  assert.equal(currentUser.body.data.user.role, 'user')

  const logout = await agent.post('/api/auth/logout').set('Origin', 'http://localhost:5173')
  assert.equal(logout.status, 200)
  assert.match(logout.headers['set-cookie'][0], /HttpOnly/)

  const user = await User.findOne({ email: 'auth.integration@legalease.test' })
  user.status = 'deactivated'
  await user.save()
  const disabledLogin = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'auth.integration@legalease.test', password: 'Secure-test-password-123!' })
  assert.equal(disabledLogin.status, 401)
  assert.equal(disabledLogin.body.error.code, 'INVALID_CREDENTIALS')
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

  const [{ default: request }, mongoose, jwt, bcrypt, { default: app }, { User }, { authorizeRoles }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('jsonwebtoken'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/middleware/authorizeRoles.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  const testEmails = [
    'auth.integration@legalease.test',
    'lawyer.integration@legalease.test',
    'seed-admin.integration@legalease.test',
    'seed-conflict.integration@legalease.test',
  ]
  await User.deleteMany({ email: { $in: testEmails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: testEmails } })
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
  assert.match(registration.headers['set-cookie'][0], /SameSite=Lax/)
  assert.doesNotMatch(registration.headers['set-cookie'][0], /Secure/)
  assert.equal(registration.body.data.token, undefined)

  const sessionToken = decodeURIComponent(registration.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('='))
  const decodedToken = jwt.decode(sessionToken)
  assert.equal(decodedToken.exp - decodedToken.iat, 7 * 24 * 60 * 60)

  const storedUser = await User.findOne({ email: 'auth.integration@legalease.test' }).select('+passwordHash')
  assert.notEqual(storedUser.passwordHash, 'Secure-test-password-123!')
  assert.equal(await bcrypt.compare('Secure-test-password-123!', storedUser.passwordHash), true)

  const lawyerRegistration = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Integration Lawyer', email: 'lawyer.integration@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'Secure-test-password-123!', role: 'lawyer' })
  assert.equal(lawyerRegistration.status, 201)
  assert.equal(lawyerRegistration.body.data.user.role, 'lawyer')

  const duplicate = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Duplicate User', email: 'auth.integration@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'Secure-test-password-123!', role: 'user' })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'EMAIL_ALREADY_REGISTERED')

  const adminRole = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Bad Role', email: 'admin-denied@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'Secure-test-password-123!', role: 'admin' })
  assert.equal(adminRole.status, 400)

  const mismatch = await request(app).post('/api/auth/register')
    .set('Origin', 'http://localhost:5173')
    .send({ fullName: 'Mismatch User', email: 'mismatch@legalease.test', password: 'Secure-test-password-123!', confirmPassword: 'different-password', role: 'user' })
  assert.equal(mismatch.status, 400)

  const invalidLogin = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'auth.integration@legalease.test', password: 'wrong-password' })
  assert.equal(invalidLogin.status, 401)
  assert.equal(invalidLogin.body.error.code, 'INVALID_CREDENTIALS')

  const unknownLogin = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'unknown@legalease.test', password: 'Secure-test-password-123!' })
  assert.equal(unknownLogin.status, 401)
  assert.deepEqual(unknownLogin.body.error, invalidLogin.body.error)

  const login = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'auth.integration@legalease.test', password: 'Secure-test-password-123!' })
  assert.equal(login.status, 200)
  assert.equal(login.body.data.token, undefined)

  const currentUser = await agent.get('/api/auth/me')
  assert.equal(currentUser.status, 200)
  assert.equal(currentUser.body.data.user.role, 'user')

  const authoritativeUser = await User.findById(storedUser.id)
  authoritativeUser.role = 'lawyer'
  await authoritativeUser.save()
  const changedRole = await agent.get('/api/auth/me')
  assert.equal(changedRole.status, 200)
  assert.equal(changedRole.body.data.user.role, 'lawyer')

  authoritativeUser.status = 'deactivated'
  await authoritativeUser.save()
  const deactivatedSession = await agent.get('/api/auth/me')
  assert.equal(deactivatedSession.status, 401)
  authoritativeUser.status = 'active'
  authoritativeUser.role = 'user'
  await authoritativeUser.save()

  const unauthenticated = await request(app).get('/api/auth/me')
  assert.equal(unauthenticated.status, 401)

  const authorizes = (role, allowedRoles) => new Promise((resolve) => {
    authorizeRoles(...allowedRoles)({ auth: { user: { role } } }, {}, (error) => resolve(error?.code ?? 'ALLOWED'))
  })
  assert.equal(await authorizes('user', ['user']), 'ALLOWED')
  assert.equal(await authorizes('lawyer', ['user']), 'AUTHORIZATION_DENIED')
  assert.equal(await authorizes('admin', ['admin']), 'ALLOWED')

  const logout = await agent.post('/api/auth/logout').set('Origin', 'http://localhost:5173')
  assert.equal(logout.status, 200)
  assert.match(logout.headers['set-cookie'][0], /HttpOnly/)
  assert.match(logout.headers['set-cookie'][0], /SameSite=Lax/)
  assert.match(logout.headers['set-cookie'][0], /Expires=/)

  const afterLogout = await agent.get('/api/auth/me')
  assert.equal(afterLogout.status, 401)

  const user = await User.findOne({ email: 'auth.integration@legalease.test' })
  user.status = 'deactivated'
  await user.save()
  const disabledLogin = await request(app).post('/api/auth/login')
    .set('Origin', 'http://localhost:5173')
    .send({ email: 'auth.integration@legalease.test', password: 'Secure-test-password-123!' })
  assert.equal(disabledLogin.status, 401)
  assert.equal(disabledLogin.body.error.code, 'INVALID_CREDENTIALS')

  const seedEnvironment = {
    ...process.env,
    MONGODB_URI: testUri,
    MONGODB_DB_NAME: testDatabase,
    ADMIN_NAME: 'Seed Integration Admin',
    ADMIN_EMAIL: 'seed-admin.integration@legalease.test',
    ADMIN_PASSWORD: 'Seed-integration-password-123!',
  }
  const runSeed = (environment = seedEnvironment) => spawnSync(process.execPath, ['scripts/seedAdmin.js'], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  })

  assert.equal(runSeed().status, 0)
  assert.equal(runSeed().status, 0)
  const seededAdmin = await User.findOne({ email: seedEnvironment.ADMIN_EMAIL }).select('+passwordHash')
  assert.equal(seededAdmin.role, 'admin')
  assert.equal(await bcrypt.compare(seedEnvironment.ADMIN_PASSWORD, seededAdmin.passwordHash), true)
  assert.equal(await User.countDocuments({ email: seedEnvironment.ADMIN_EMAIL }), 1)

  await User.create({
    fullName: 'Seed Conflict User',
    email: 'seed-conflict.integration@legalease.test',
    passwordHash: await bcrypt.hash('Conflict-password-123!', 12),
    role: 'user',
    providers: ['local'],
  })
  const conflictSeed = runSeed({ ...seedEnvironment, ADMIN_EMAIL: 'seed-conflict.integration@legalease.test' })
  assert.notEqual(conflictSeed.status, 0)
  const conflictingUser = await User.findOne({ email: 'seed-conflict.integration@legalease.test' })
  assert.equal(conflictingUser.role, 'user')
})

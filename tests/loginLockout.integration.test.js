import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('repeated failed logins lock the account and successful login resets the counter', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()

  const email = 'login-lockout.integration@legalease.test'
  const realPassword = randomBytes(16).toString('base64url')
  const wrongPassword = randomBytes(16).toString('base64url')
  await User.deleteMany({ email })
  context.after(async () => {
    await User.deleteMany({ email })
    await mongoose.disconnect()
  })

  await User.create({
    fullName: 'Login Lockout Integration',
    email,
    passwordHash: await bcrypt.hash(realPassword, 12),
    role: 'user',
    providers: ['local'],
  })

  function attempt(password) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email, password })
  }

  for (let round = 1; round <= 5; round += 1) {
    const failed = await attempt(wrongPassword)
    assert.equal(failed.status, 401)
    assert.equal(failed.body.error.code, 'INVALID_CREDENTIALS')
    const tracked = await User.findOne({ email }).select('+accountLockedUntil failedLoginAttempts')
    assert.equal(tracked.failedLoginAttempts, round)
    if (round === 5) {
      assert.ok(tracked.accountLockedUntil.getTime() > Date.now() + 29 * 60 * 1000)
    } else {
      assert.equal(tracked.accountLockedUntil, null)
    }
  }

  const locked = await attempt(realPassword)
  assert.equal(locked.status, 429)
  assert.equal(locked.body.error.code, 'ACCOUNT_TEMPORARILY_LOCKED')
  assert.match(locked.body.error.message, /Account temporarily locked\. Try again in \d+ minutes?\./)

  const victim = await User.findOne({ email }).select('+accountLockedUntil')
  victim.accountLockedUntil = new Date(Date.now() - 1_000)
  await victim.save()

  const recovered = await attempt(realPassword)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.data.user.email, email)

  const resetState = await User.findOne({ email }).select('+accountLockedUntil failedLoginAttempts')
  assert.equal(resetState.failedLoginAttempts, 0)
  assert.equal(resetState.accountLockedUntil, null)

  const restoredSession = await request(app).get('/api/auth/me').set(
    'Cookie',
    decodeURIComponent(recovered.headers['set-cookie'][0].split(';')[0]),
  )
  assert.equal(restoredSession.status, 200)

  const unknownEmailProbe = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'ghost.lockout@legalease.test', password: wrongPassword })
  assert.equal(unknownEmailProbe.status, 401)
  assert.equal(unknownEmailProbe.body.error.code, 'INVALID_CREDENTIALS')
})

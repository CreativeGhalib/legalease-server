import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

function cookieHeader(response) {
  return decodeURIComponent(response.headers['set-cookie'][0].split(';')[0])
}

test('forgot/reset/change password endpoint integration', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
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

  const email = 'password-reset.integration@legalease.test'
  const originalPassword = randomBytes(16).toString('base64url')
  const rotatedPassword = randomBytes(16).toString('base64url')
  const finalPassword = randomBytes(16).toString('base64url')
  await User.deleteMany({ email })
  context.after(async () => {
    await User.deleteMany({ email })
    await mongoose.disconnect()
  })

  await User.create({
    fullName: 'Password Reset Integration',
    email,
    passwordHash: await bcrypt.hash(originalPassword, 12),
    role: 'user',
    providers: ['local'],
  })

  // ── POST /api/auth/forgot-password ────────────────────────────────────────

  const initialLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: originalPassword })
  assert.equal(initialLogin.status, 200)

  const forgotKnown = await request(app).post('/api/auth/forgot-password').set('Origin', origin).send({ email })
  assert.equal(forgotKnown.status, 200)
  assert.equal(forgotKnown.body.success, true)
  const genericMessage = forgotKnown.body.data.message

  const stored = await User.findOne({ email }).select('+passwordResetToken +passwordResetExpires')
  assert.match(stored.passwordResetToken, /^[a-f0-9]{64}$/)
  assert.ok(stored.passwordResetExpires.getTime() > Date.now())

  const forgotUnknown = await request(app).post('/api/auth/forgot-password').set('Origin', origin).send({ email: 'nobody.password-reset@legalease.test' })
  assert.equal(forgotUnknown.status, 200)
  assert.equal(forgotUnknown.body.data.message, genericMessage)
  assert.equal(forgotUnknown.body.success, true)

  const forgotInvalid = await request(app).post('/api/auth/forgot-password').set('Origin', origin).send({ email: 'not-an-email' })
  assert.equal(forgotInvalid.status, 400)
  assert.equal(forgotInvalid.body.error.code, 'VALIDATION_ERROR')

  // ── POST /api/auth/reset-password ─────────────────────────────────────────

  const rawValidToken = randomBytes(32).toString('hex')
  stored.passwordResetToken = createHash('sha256').update(rawValidToken).digest('hex')
  stored.passwordResetExpires = new Date(Date.now() + 60_000)
  await stored.save()

  const resetOk = await request(app).post('/api/auth/reset-password').set('Origin', origin).send({ token: rawValidToken, password: rotatedPassword })
  assert.equal(resetOk.status, 200)
  assert.equal(resetOk.body.data.user.email, email)

  const cleared = await User.findOne({ email }).select('+passwordResetToken +passwordResetExpires +passwordHash +tokenVersion')
  assert.equal(cleared.passwordResetToken, null)
  assert.equal(cleared.passwordResetExpires, null)
  assert.equal(await bcrypt.compare(rotatedPassword, cleared.passwordHash), true)

  const freshSession = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(resetOk))
  assert.equal(freshSession.status, 200)
  assert.equal(freshSession.body.data.user.email, email)

  const oldSession = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(initialLogin))
  assert.equal(oldSession.status, 401)

  const rawExpiredToken = randomBytes(32).toString('hex')
  cleared.passwordResetToken = createHash('sha256').update(rawExpiredToken).digest('hex')
  cleared.passwordResetExpires = new Date(Date.now() - 1_000)
  await cleared.save()
  const resetExpired = await request(app).post('/api/auth/reset-password').set('Origin', origin).send({ token: rawExpiredToken, password: rotatedPassword })
  assert.equal(resetExpired.status, 400)
  assert.equal(resetExpired.body.error.code, 'INVALID_RESET_TOKEN')

  const resetFake = await request(app).post('/api/auth/reset-password').set('Origin', origin).send({ token: randomBytes(32).toString('hex'), password: rotatedPassword })
  assert.equal(resetFake.status, 400)
  assert.equal(resetFake.body.error.code, 'INVALID_RESET_TOKEN')

  const rawWeakCaseToken = randomBytes(32).toString('hex')
  cleared.passwordResetToken = createHash('sha256').update(rawWeakCaseToken).digest('hex')
  cleared.passwordResetExpires = new Date(Date.now() + 60_000)
  await cleared.save()
  const resetWeak = await request(app).post('/api/auth/reset-password').set('Origin', origin).send({ token: rawWeakCaseToken, password: 'short12char' })
  assert.equal(resetWeak.status, 400)
  assert.equal(resetWeak.body.error.code, 'VALIDATION_ERROR')

  // ── PATCH /api/auth/change-password ───────────────────────────────────────

  const relogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: rotatedPassword })
  assert.equal(relogin.status, 200)

  const changeOk = await request(app).patch('/api/auth/change-password').set('Origin', origin).set('Cookie', cookieHeader(relogin)).send({ currentPassword: rotatedPassword, newPassword: finalPassword })
  assert.equal(changeOk.status, 200)
  const afterChange = await User.findOne({ email }).select('+passwordHash +tokenVersion')
  assert.equal(await bcrypt.compare(finalPassword, afterChange.passwordHash), true)
  const newestSession = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(changeOk))
  assert.equal(newestSession.status, 200)

  const changeAnon = await request(app).patch('/api/auth/change-password').set('Origin', origin).send({ currentPassword: finalPassword, newPassword: rotatedPassword })
  assert.equal(changeAnon.status, 401)
  assert.equal(changeAnon.body.error.code, 'AUTHENTICATION_REQUIRED')

  const changeWrong = await request(app).patch('/api/auth/change-password').set('Origin', origin).set('Cookie', cookieHeader(changeOk)).send({ currentPassword: 'definitely-not-it', newPassword: rotatedPassword })
  assert.equal(changeWrong.status, 401)
  assert.equal(changeWrong.body.error.code, 'INVALID_CREDENTIALS')

  const changeMissing = await request(app).patch('/api/auth/change-password').set('Origin', origin).set('Cookie', cookieHeader(changeOk)).send({})
  assert.equal(changeMissing.status, 400)
  assert.equal(changeMissing.body.error.code, 'VALIDATION_ERROR')

  const restoredLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: finalPassword })
  assert.equal(restoredLogin.status, 200)
})

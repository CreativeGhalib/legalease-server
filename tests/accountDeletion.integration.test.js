import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'
const DAY = 24 * 60 * 60 * 1000

test('account deletion grace period, lazy anonymization, and session revocation', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { Appointment }, { AuditLog }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/Appointment.js'),
    import('../src/models/AuditLog.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await Appointment.init()
  await AuditLog.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['del-local', 'del-google', 'del-revoke'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await Appointment.deleteMany({})
    await AuditLog.deleteMany({})
    await mongoose.disconnect()
  })

  const [localUser, googleUser, revokeUser] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Delete ${email.split('.')[0]}`, email, passwordHash: email.includes('google') ? undefined : passwordHash, role: 'user', providers: email.includes('google') ? ['google'] : ['local'] }),
  ))

  function cookieFrom(response) {
    return decodeURIComponent(response.headers['set-cookie'][0].split(';')[0])
  }
  async function login(user) {
    const response = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
    assert.equal(response.status, 200)
    return cookieFrom(response)
  }

  // Wrong-password delete-request rejected.
  const localCookie = await login(localUser)
  const wrongPw = await request(app)
    .post('/api/users/me/delete-request')
    .set('Origin', origin)
    .set('Cookie', localCookie)
    .send({ password: 'wrong-password' })
  assert.equal(wrongPw.status, 401)
  assert.equal(wrongPw.body.error.code, 'INVALID_CREDENTIALS')

  // Correct request sets a due date ~7 days out; account still usable.
  const requested = await request(app)
    .post('/api/users/me/delete-request')
    .set('Origin', origin)
    .set('Cookie', localCookie)
    .send({ password: sharedPassword })
  assert.equal(requested.status, 200)

  const pendingUser = await User.findById(localUser._id).select('+deletionRequestedAt')
  assert.ok(pendingUser.deletionRequestedAt.getTime() > Date.now() + 6 * DAY)

  const meDuringGrace = await request(app).get('/api/users/me').set('Cookie', localCookie)
  assert.equal(meDuringGrace.status, 200)
  assert.ok(meDuringGrace.body.data.user.deletionRequestedAt)

  const reloginDuringGrace = await login(localUser)
  assert.ok(reloginDuringGrace.length > 20)

  // Cancel clears the request.
  const cancel = await request(app).delete('/api/users/me/delete-request').set('Origin', origin).set('Cookie', reloginDuringGrace)
  assert.equal(cancel.status, 200)
  assert.equal(cancel.body.data.cancelled, true)
  let cleared = await User.findById(localUser._id).select('+deletionRequestedAt')
  assert.equal(cleared.deletionRequestedAt, null)

  // Re-request, then backdate past the window and hit /auth/me — lazy finalize fires once.
  await request(app)
    .post('/api/users/me/delete-request')
    .set('Origin', origin)
    .set('Cookie', reloginDuringGrace)
    .send({ password: sharedPassword })

  cleared = await User.findById(localUser._id).select('+deletionRequestedAt')
  const oldCookieBeforeBackdate = reloginDuringGrace
  const upcomingAppointment = await Appointment.create({
    lawyerProfileId: new mongoose.Types.ObjectId(),
    userId: localUser._id,
    dateKey: '2099-12-31',
    start: '10:00',
    end: '10:30',
  })
  await User.updateOne({ _id: localUser._id }, { $set: { deletionRequestedAt: new Date(Date.now() - 1_000) } })

  const finalizedProbe = await request(app).get('/api/auth/me').set('Cookie', oldCookieBeforeBackdate)
  assert.equal(finalizedProbe.status, 401)
  assert.equal(finalizedProbe.body.error.code, 'AUTHENTICATION_REQUIRED')

  const anonymized = await User.findById(localUser._id).select('+passwordHash +deletionRequestedAt')
  assert.match(anonymized.email, /^deleted\+.*@legalease\.invalid$/)
  assert.equal(anonymized.fullName, 'Deleted User')
  assert.equal(anonymized.profileImageUrl, '')
  assert.equal(anonymized.passwordHash, undefined)
  assert.equal(anonymized.googleSub, undefined)
  assert.equal(anonymized.status, 'deactivated')

  // Old JWT now fails (tokenVersion bump).
  const staleSession = await request(app).get('/api/auth/me').set('Cookie', oldCookieBeforeBackdate)
  assert.equal(staleSession.status, 401)

  // Login is impossible post-deletion.
  const postDeleteLogin = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: emails[0], password: sharedPassword })
  assert.equal(postDeleteLogin.status, 401)

  // Upcoming scheduled appointment auto-cancelled by finalize.
  assert.equal((await Appointment.findById(upcomingAppointment._id)).status, 'cancelled')

  const deletionAudit = await AuditLog.findOne({ action: 'account.delete' }).lean()
  assert.ok(deletionAudit, 'expected an account.delete audit entry')
  assert.equal(deletionAudit.targetId, String(localUser._id))

  // Google-only user can request deletion with confirm flag (no password).
  const { createSessionToken } = await import('../src/utils/auth.js')
  const googleCookie = `legalease_session=${encodeURIComponent(createSessionToken(googleUser))}`
  const googleConfirm = await request(app)
    .post('/api/users/me/delete-request')
    .set('Origin', origin)
    .set('Cookie', googleCookie)
    .send({ confirm: true })
  assert.equal(googleConfirm.status, 200)

  // Session revocation: fresh login for revoke user, then revoke-all.
  const revokeCookie = await login(revokeUser)
  const badRevoke = await request(app)
    .patch('/api/users/me/revoke-sessions')
    .set('Origin', origin)
    .set('Cookie', revokeCookie)
    .send({ password: 'wrong' })
  assert.equal(badRevoke.status, 401)

  const goodRevoke = await request(app)
    .patch('/api/users/me/revoke-sessions')
    .set('Origin', origin)
    .set('Cookie', revokeCookie)
    .send({ password: sharedPassword })
  assert.equal(goodRevoke.status, 200)
  assert.equal(goodRevoke.body.data.message, 'All other sessions have been signed out.')

  const revokedAudit = await AuditLog.findOne({ action: 'session.revoke_all' }).lean()
  assert.ok(revokedAudit)
})

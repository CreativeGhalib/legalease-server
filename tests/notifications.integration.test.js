import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('notification triggers fire on hiring lifecycle and read state is owner-scoped', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { Notification }, { createNotification }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/Notification.js'),
    import('../src/services/notificationService.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await Notification.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = [`notif-lawyer.${suffix}`, `notif-client.${suffix}`, `notif-other.${suffix}`, `notif-expiring.${suffix}`].map((local) => `${local}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await Notification.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, client, outsider, expiringClient] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Notif ${email.slice(6, 12)}`, email, passwordHash, role: email === emails[0] ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/notif-portrait.png',
    specialization: 'Criminal Law',
    bio: 'Bail and trial practice.',
    consultationFeeMinor: 12000,
    experienceYears: 7,
    licenseNumber: 'BAR-NOTIF-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
    availability: 'available',
  })

  const unauth = await request(app).get('/api/notifications')
  assert.equal(unauth.status, 401)

  const clientCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: client.email, password: sharedPassword })).headers['set-cookie'][0].split(';')[0])
  const lawyerCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: lawyer.email, password: sharedPassword })).headers['set-cookie'][0].split(';')[0])
  const expiringClientCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: expiringClient.email, password: sharedPassword })).headers['set-cookie'][0].split(';')[0])

  const hire = await request(app)
    .post('/api/hiring-requests')
    .set('Origin', origin)
    .set('Cookie', clientCookie)
    .send({ lawyerProfileId: String(profile.id) })
  assert.equal(hire.status, 201)

  let lawyerFeed = await request(app).get('/api/notifications').set('Cookie', lawyerCookie)
  assert.equal(lawyerFeed.body.data.unreadCount, 1)
  assert.equal(lawyerFeed.body.data.items[0].type, 'hire_request')
  assert.equal(lawyerFeed.body.data.items[0].link, '/dashboard/lawyer/hiring-history')

  const decision = await request(app)
    .patch(`/api/hiring-requests/${hire.body.data.request.id}/decision`)
    .set('Origin', origin)
    .set('Cookie', lawyerCookie)
    .send({ decision: 'accepted' })
  assert.equal(decision.status, 200)

  const clientFeed = await request(app).get('/api/notifications').set('Cookie', clientCookie)
  assert.equal(clientFeed.body.data.unreadCount, 1)
  assert.equal(clientFeed.body.data.items[0].type, 'hire_decision')

  const dueRequest = await HiringRequest.create({
    clientId: expiringClient._id,
    lawyerId: lawyer._id,
    lawyerProfileId: profile._id,
    specializationSnapshot: 'Criminal Law',
    feeMinorSnapshot: 12000,
    currency: 'USD',
    status: 'pending',
    paymentStatus: 'unpaid',
    expiresAt: new Date(Date.now() - 60_000),
  })
  await request(app).get('/api/hiring-requests/mine').set('Cookie', expiringClientCookie)
  const swept = await Notification.findOne({ userId: expiringClient._id, type: 'sla_expired' }).lean()
  assert.ok(swept, 'SLA sweep should create the expiry notification')
  await HiringRequest.deleteOne({ _id: dueRequest._id })

  const firstItem = lawyerFeed.body.data.items[0]
  const foreignRead = await request(app)
    .patch(`/api/notifications/${firstItem.id}/read`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
  assert.equal(foreignRead.status, 404)
  assert.equal(foreignRead.body.error.code, 'NOTIFICATION_NOT_FOUND')

  const markedRead = await request(app)
    .patch(`/api/notifications/${firstItem.id}/read`)
    .set('Origin', origin)
    .set('Cookie', lawyerCookie)
  assert.equal(markedRead.status, 200)
  assert.equal(markedRead.body.data.notification.isRead, true)

  const afterMark = await request(app).get('/api/notifications?unread=true').set('Cookie', lawyerCookie)
  assert.equal(afterMark.body.data.unreadCount, 0)

  for (let index = 0; index < 3; index += 1) {
    await createNotification({ userId: outsider._id, title: `Note ${index}`, message: 'Body', type: 'system' })
  }
  const outsiderCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: outsider.email, password: sharedPassword })).headers['set-cookie'][0].split(';')[0])
  const markAll = await request(app).patch('/api/notifications/read-all').set('Origin', origin).set('Cookie', outsiderCookie)
  assert.equal(markAll.status, 200)
  assert.equal(markAll.body.data.updated, 3)

  const capProbe = Array.from({ length: 55 }, (_, index) => ({
    userId: outsider._id,
    title: `Cap ${index}`,
    message: 'Trim probe',
    type: 'system',
  }))
  await Notification.insertMany(capProbe.slice(0, 5))
  for (const probe of capProbe.slice(5)) {
    await createNotification(probe)
  }
  const remaining = await Notification.countDocuments({ userId: outsider._id })
  assert.ok(remaining <= 50, `per-user cap should hold, got ${remaining}`)
})

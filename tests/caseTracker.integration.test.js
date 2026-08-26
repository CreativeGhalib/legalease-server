import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('case milestones gate on paid engagements with forward-only lawyer-owned updates', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { CaseMilestone }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/CaseMilestone.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await CaseMilestone.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['crm-lawyer', 'crm-client-paid', 'crm-client-unpaid', 'crm-outsider'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await CaseMilestone.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, paidClient, unpaidClient, outsider] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `CRM ${email.split('.')[0]}`, email, passwordHash, role: email.startsWith('crm-lawyer') ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/crm-portrait.png',
    specialization: 'Family Law',
    bio: 'Custody and mediation.',
    consultationFeeMinor: 20000,
    experienceYears: 10,
    licenseNumber: 'BAR-CRM-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function seedEngagement(client, paymentStatus) {
    return HiringRequest.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Family Law',
      feeMinorSnapshot: 20000,
      currency: 'USD',
      status: 'accepted',
      paymentStatus,
      decisionAt: new Date(),
      paidAt: paymentStatus === 'paid' ? new Date() : null,
    })
  }

  const paidEngagement = await seedEngagement(paidClient, 'paid')
  const unpaidEngagement = await seedEngagement(unpaidClient, 'unpaid')

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }
  function cookieFor(user) {
    return decodeURIComponent((user.__cookie ?? '').length ? user.__cookie : '')
  }

  const cookies = {}
  for (const user of [lawyer, paidClient, unpaidClient, outsider]) {
    const loginResponse = await login(user)
    assert.equal(loginResponse.status, 200)
    cookies[user.email] = decodeURIComponent(loginResponse.headers['set-cookie'][0].split(';')[0])
  }
  const asUser = (user) => ({ Cookie: cookies[user.email], Origin: origin })

  const unauth = await request(app).get(`/api/cases/${paidEngagement.id}`)
  assert.equal(unauth.status, 401)

  const outsiderView = await request(app).get(`/api/cases/${paidEngagement.id}`).set(asUser(outsider))
  assert.equal(outsiderView.status, 404)
  assert.equal(outsiderView.body.error.code, 'CASE_NOT_FOUND')

  const ineligible = await request(app).get(`/api/cases/${unpaidEngagement.id}`).set(asUser(unpaidClient))
  assert.equal(ineligible.status, 403)
  assert.equal(ineligible.body.error.code, 'CASE_NOT_ELIGIBLE')

  const clientCreateAttempt = await request(app)
    .post(`/api/cases/${paidEngagement.id}/milestones`)
    .set(asUser(paidClient))
    .send({ title: 'Client cannot add milestones' })
  assert.equal(clientCreateAttempt.status, 403)

  const first = await request(app)
    .post(`/api/cases/${paidEngagement.id}/milestones`)
    .set(asUser(lawyer))
    .send({ title: 'Draft bail petition', description: 'Collect affidavits.' })
  assert.equal(first.status, 201)
  assert.equal(first.body.data.milestone.order, 0)

  const second = await request(app)
    .post(`/api/cases/${paidEngagement.id}/milestones`)
    .set(asUser(lawyer))
    .send({ title: 'Court hearing prep', dueDate: '2026-09-15' })
  assert.equal(second.status, 201)

  const timeline = await request(app).get(`/api/cases/${paidEngagement.id}`).set(asUser(paidClient))
  assert.equal(timeline.status, 200)
  assert.equal(timeline.body.data.summary.total, 2)
  assert.equal(timeline.body.data.milestones[1].title, 'Court hearing prep')

  const advance = await request(app)
    .patch(`/api/cases/milestones/${first.body.data.milestone.id}`)
    .set(asUser(lawyer))
    .send({ status: 'completed' })
  assert.equal(advance.status, 200)
  assert.ok(advance.body.data.milestone.completedAt)

  const backward = await request(app)
    .patch(`/api/cases/milestones/${first.body.data.milestone.id}`)
    .set(asUser(lawyer))
    .send({ status: 'pending' })
  assert.equal(backward.status, 409)
  assert.equal(backward.body.error.code, 'INVALID_MILESTONE_TRANSITION')

  const crossLawyerPatch = await request(app)
    .patch(`/api/cases/milestones/${first.body.data.milestone.id}`)
    .set(asUser(unpaidClient))
    .send({ status: 'completed' })
  assert.equal(crossLawyerPatch.status, 403)

  const receivedList = await request(app).get('/api/hiring-requests/received').set(asUser(lawyer))
  const paidRow = receivedList.body.data.items.find((item) => item.id === String(paidEngagement.id))
  assert.deepEqual(paidRow.milestoneSummary, { total: 2, completed: 1 })

  for (let index = 0; index < 18; index += 1) {
    await CaseMilestone.create({
      hiringRequestId: paidEngagement._id,
      createdByLawyerId: lawyer._id,
      title: `Filler milestone ${index}`,
      order: index + 2,
    })
  }
  const capCheck = await request(app)
    .post(`/api/cases/${paidEngagement.id}/milestones`)
    .set(asUser(lawyer))
    .send({ title: 'One too many' })
  assert.equal(capCheck.status, 409)
  assert.equal(capCheck.body.error.code, 'MILESTONE_LIMIT_REACHED')
})

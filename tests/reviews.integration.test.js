import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('paid engagements can be reviewed once and lawyer ratings aggregate publicly', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { Review }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/Review.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await Review.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = [`review-lawyer.${suffix}`, `review-client-a.${suffix}`, `review-client-b.${suffix}`, `review-client-c.${suffix}`]
    .map((local) => `${local}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await Review.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, clientA, clientB, clientC] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Review Fixture ${email.slice(7, 12)}`, email, passwordHash, role: email === emails[0] ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/review-portrait.png',
    specialization: 'Criminal Law',
    bio: 'Focused trial practice.',
    consultationFeeMinor: 20000,
    experienceYears: 8,
    licenseNumber: 'BAR-REV-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function paidRequest(client, status = 'accepted') {
    return HiringRequest.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Criminal Law',
      feeMinorSnapshot: 20000,
      currency: 'USD',
      status,
      paymentStatus: status === 'accepted' ? 'paid' : 'unpaid',
      decisionAt: new Date(),
      paidAt: status === 'accepted' ? new Date() : null,
    })
  }

  const engagementA = await paidRequest(clientA)
  const engagementB = await paidRequest(clientB)
  const pendingEngagementC = await paidRequest(clientC, 'pending')

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }

  function submitReview(cookie, body) {
    return request(app).post('/api/reviews').set('Origin', origin).set('Cookie', cookie).send(body)
  }

  const unauth = await submitReview('', { hiringRequestId: String(engagementA.id), rating: 5 })
  assert.equal(unauth.status, 401)
  assert.equal(unauth.body.error.code, 'AUTHENTICATION_REQUIRED')

  const forbiddenRole = await submitReview(decodeURIComponent((await login(lawyer)).headers['set-cookie'][0].split(';')[0]), { hiringRequestId: String(engagementA.id), rating: 5 })
  assert.equal(forbiddenRole.status, 403)
  assert.equal(forbiddenRole.body.error.code, 'AUTHORIZATION_DENIED')

  const cookieA = decodeURIComponent((await login(clientA)).headers['set-cookie'][0].split(';')[0])
  const invalidBody = await submitReview(cookieA, { hiringRequestId: String(engagementA.id), rating: 9 })
  assert.equal(invalidBody.status, 400)
  assert.equal(invalidBody.body.error.code, 'VALIDATION_ERROR')

  const notOwner = await request(app).get('/api/lawyers/definitely-not-an-id/reviews')
  assert.equal(notOwner.status, 404)
  assert.equal(notOwner.body.error.code, 'LAWYER_NOT_FOUND')

  const first = await submitReview(cookieA, { hiringRequestId: String(engagementA.id), rating: 5, feedback: 'Outstanding defence.' })
  assert.equal(first.status, 201)
  assert.equal(first.body.data.review.rating, 5)

  let storedProfile = await LawyerProfile.findById(profile.id)
  assert.equal(storedProfile.averageRating, 5)
  assert.equal(storedProfile.reviewCount, 1)

  const duplicate = await submitReview(cookieA, { hiringRequestId: String(engagementA.id), rating: 1 })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'REVIEW_ALREADY_EXISTS')

  const cookieB = decodeURIComponent((await login(clientB)).headers['set-cookie'][0].split(';')[0])
  const cookieC = decodeURIComponent((await login(clientC)).headers['set-cookie'][0].split(';')[0])
  const second = await submitReview(cookieB, { hiringRequestId: String(engagementB.id), rating: 3 })
  assert.equal(second.status, 201)

  storedProfile = await LawyerProfile.findById(profile.id)
  assert.equal(storedProfile.averageRating, 4)
  assert.equal(storedProfile.reviewCount, 2)

  const ineligible = await submitReview(cookieC, { hiringRequestId: String(pendingEngagementC.id), rating: 5 })
  assert.equal(ineligible.status, 403)
  assert.equal(ineligible.body.error.code, 'REVIEW_NOT_ELIGIBLE')

  const publicList = await request(app).get(`/api/lawyers/${profile.id}/reviews`).query({ page: 1, limit: 1 })
  assert.equal(publicList.status, 200)
  assert.equal(publicList.body.data.items.length, 1)
  assert.equal(publicList.body.meta.totalItems, 2)
  assert.deepEqual(publicList.body.data.ratingCounts, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...Object.fromEntries([[3, 1], [5, 1]]) })
  assert.equal(publicList.body.data.items[0].rating, 3)
  assert.equal(publicList.body.data.items[0].reviewer.fullName.includes('Review Fixture'), true)
})

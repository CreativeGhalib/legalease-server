import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('case evidence vault is party-scoped, paid-gated, capped, and permission-checked', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin
  process.env.IMGBB_API_KEY = 'test-imgbb-key'

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { CaseDocument }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/CaseDocument.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await CaseDocument.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['vault-lawyer', 'vault-client', 'vault-outsider', 'vault-unpaid'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })

  let uploadCount = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('imgbb')) {
      uploadCount += 1
      return {
        ok: true,
        json: async () => ({ success: true, data: { url: `https://i.ibb.co/mock-${uploadCount}.png`, display_url: `https://i.ibb.co/mock-${uploadCount}.png` } }),
      }
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  context.after(async () => {
    globalThis.fetch = originalFetch
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await CaseDocument.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, client, outsider, unpaidClient] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Vault ${email.split('.')[0]}`, email, passwordHash, role: email.startsWith('vault-lawyer') ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/vault-portrait.png',
    specialization: 'Property Law',
    bio: 'Land documentation.',
    consultationFeeMinor: 16000,
    experienceYears: 5,
    licenseNumber: 'BAR-VAULT-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function seedEngagement(clientUser, paymentStatus) {
    return HiringRequest.create({
      clientId: clientUser.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Property Law',
      feeMinorSnapshot: 16000,
      currency: 'USD',
      status: 'accepted',
      paymentStatus,
      decisionAt: new Date(),
      paidAt: paymentStatus === 'paid' ? new Date() : null,
    })
  }

  const paidEngagement = await seedEngagement(client, 'paid')
  await seedEngagement(unpaidClient, 'unpaid')

  async function cookieFor(user) {
    const response = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
    assert.equal(response.status, 200)
    return decodeURIComponent(response.headers['set-cookie'][0].split(';')[0])
  }
  const clientCookie = await cookieFor(client)
  const outsiderCookie = await cookieFor(outsider)
  const unpaidCookie = await cookieFor(unpaidClient)
  const lawyerCookie = await cookieFor(lawyer)

  const unauthUpload = await request(app)
    .post(`/api/cases/${paidEngagement._id}/documents`)
    .set('Origin', origin)
    .attach('image', Buffer.from([0x89, 0x50]), { filename: 'a.png', contentType: 'image/png' })
  assert.equal(unauthUpload.status, 401)

  // Outsider is not a party — privacy-safe 404.
  const outsiderUpload = await request(app)
    .post(`/api/cases/${paidEngagement._id}/documents`)
    .set('Origin', origin)
    .set('Cookie', outsiderCookie)
    .attach('image', Buffer.from([0x89, 0x50]), { filename: 'b.png', contentType: 'image/png' })
  assert.equal(outsiderUpload.status, 404)

  // Unpaid engagement is gated.
  const unpaidEngagement = await HiringRequest.findOne({ clientId: unpaidClient._id })
  const unpaidAttempt = await request(app)
    .post(`/api/cases/${unpaidEngagement._id}/documents`)
    .set('Origin', origin)
    .set('Cookie', unpaidCookie)
    .attach('image', Buffer.from([0x89, 0x50]), { filename: 'c.png', contentType: 'image/png' })
  assert.equal(unpaidAttempt.status, 403)
  assert.equal(unpaidAttempt.body.error.code, 'CASE_NOT_ELIGIBLE')

  // MIME allowlist rejects non-images before imgBB is contacted.
  const uploadsBeforeMimeCheck = uploadCount
  const badMime = await request(app)
    .post(`/api/cases/${paidEngagement._id}/documents`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
    .attach('image', Buffer.from('%PDF-1.4 fake'), { filename: 'evil.pdf', contentType: 'application/pdf' })
  assert.equal(badMime.status, 400)
  assert.equal(uploadCount, uploadsBeforeMimeCheck)

  const happy = await request(app)
    .post(`/api/cases/${paidEngagement._id}/documents`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
    .attach('image', Buffer.from([0x89, 0x50, 0x49, 0x46]), { filename: 'evidence-one.png', contentType: 'image/png' })
  assert.equal(happy.status, 201)
  assert.match(happy.body.data.document.imageUrl, /^https:\/\/i\.ibb\.co\//)
  assert.equal(happy.body.data.document.uploadedByMe, true)

  const listForOutsider = await request(app)
    .get(`/api/cases/${paidEngagement._id}/documents`)
    .set('Cookie', outsiderCookie)
  assert.equal(listForOutsider.status, 404)

  const list = await request(app)
    .get(`/api/cases/${paidEngagement._id}/documents`)
    .set('Cookie', clientCookie)
  assert.equal(list.status, 200)
  assert.equal(list.body.data.items.length, 1)
  assert.equal(list.body.data.items[0].uploadedByMe, true)

  // Cap: fill to 20 active docs then expect 409.
  for (let index = 0; index < 19; index += 1) {
    await CaseDocument.create({
      hiringRequestId: paidEngagement._id,
      uploadedById: client._id,
      uploadedByRole: 'user',
      imageUrl: `https://i.ibb.co/filler-${index}.png`,
      originalName: `filler-${index}.png`,
      mimeType: 'image/png',
    })
  }
  const capReached = await request(app)
    .post(`/api/cases/${paidEngagement._id}/documents`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
    .attach('image', Buffer.from([0x89, 0x50]), { filename: 'over.png', contentType: 'image/png' })
  assert.equal(capReached.status, 409)
  assert.equal(capReached.body.error.code, 'DOCUMENT_LIMIT_REACHED')

  // Delete permissions: other-client cannot even see it; uploader can soft-delete.
  const uploadedId = happy.body.data.document.id
  const outsiderDelete = await request(app)
    .delete(`/api/cases/documents/${uploadedId}`)
    .set('Origin', origin)
    .set('Cookie', outsiderCookie)
  assert.equal(outsiderDelete.status, 404)

  const uploaderDelete = await request(app)
    .delete(`/api/cases/documents/${uploadedId}`)
    .set('Origin', origin)
    .set('Cookie', clientCookie)
  assert.equal(uploaderDelete.status, 200)
  assert.equal(uploaderDelete.body.data.deleted, true)

  const listAfterDelete = await request(app)
    .get(`/api/cases/${paidEngagement._id}/documents`)
    .set('Cookie', clientCookie)
  assert.equal(listAfterDelete.body.data.items.length, 19)

  const lawyerDelete = await request(app)
    .delete(`/api/case-documents/${uploadedId}`)
    .set('Origin', origin)
    .set('Cookie', lawyerCookie)
  void lawyerDelete
})

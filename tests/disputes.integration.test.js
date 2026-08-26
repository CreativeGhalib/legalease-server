import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'
const DAY = 24 * 60 * 60 * 1000

test('disputes block release, resolve via admin refund/release, and stay race-proof', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { HiringRequest }, { PaymentTransaction }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/models/HiringRequest.js'),
    import('../src/models/PaymentTransaction.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  await HiringRequest.init()
  await PaymentTransaction.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['disp-lawyer', 'disp-client-a', 'disp-client-b'].map((local) => `${local}.${suffix}@legalease.test`)
  emails.push(`disp-admin.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await HiringRequest.deleteMany({})
    await PaymentTransaction.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, clientA, clientB, admin] = await Promise.all(emails.map((email) =>
    User.create({
      fullName: `Dispute ${email.split('.')[0]}`,
      email,
      passwordHash,
      role: email.startsWith('disp-lawyer') ? 'lawyer' : email.includes('admin') ? 'admin' : 'user',
      providers: ['local'],
    }),
  ))

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/disp-portrait.png',
    specialization: 'Family Law',
    bio: 'Custody focus.',
    consultationFeeMinor: 18000,
    experienceYears: 11,
    licenseNumber: 'BAR-DISP-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })

  function seedPaidEngagement(client, paidDaysAgo) {
    return HiringRequest.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      specializationSnapshot: 'Family Law',
      feeMinorSnapshot: 18000,
      currency: 'USD',
      status: 'accepted',
      paymentStatus: 'paid',
      decisionAt: new Date(),
      paidAt: new Date(Date.now() - paidDaysAgo * DAY),
    })
  }

  async function seedHeldTxn(engagement) {
    return PaymentTransaction.create({
      type: 'hiring_fee',
      payerId: engagement.clientId,
      lawyerId: lawyer.id,
      lawyerProfileId: profile.id,
      hiringRequestId: engagement._id,
      stripeCheckoutSessionId: `cs_test_${randomBytes(10).toString('hex')}`,
      amountMinor: engagement.feeMinorSnapshot,
      currency: 'usd',
      status: 'paid',
      escrowStatus: 'held',
      paidAt: engagement.paidAt,
    })
  }

  const disputedEngagement = await seedPaidEngagement(clientA, 5)
  const disputedTxn = await seedHeldTxn(disputedEngagement)
  const refundCandidate = await seedPaidEngagement(clientB, 29)
  const refundTxn = await seedHeldTxn(refundCandidate)
  const windowClosed = await seedPaidEngagement(clientB, 31)
  void windowClosed

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }
  async function cookieFor(user) {
    const response = await login(user)
    assert.equal(response.status, 200)
    return decodeURIComponent(response.headers['set-cookie'][0].split(';')[0])
  }

  const cookieA = await cookieFor(clientA)
  const cookieB = await cookieFor(clientB)
  const cookieLawyer = await cookieFor(lawyer)
  const cookieAdmin = await cookieFor(admin)

  // Unauthenticated dispute attempt.
  const unauth = await request(app).post('/api/disputes').set('Origin', origin).send({ hiringRequestId: String(disputedEngagement._id), reason: 'Work was not delivered at all.' })
  assert.equal(unauth.status, 401)

  // Outsider cannot open a dispute on someone else's case.
  const outsider = await request(app)
    .post('/api/disputes')
    .set('Origin', origin)
    .set('Cookie', cookieB)
    .send({ hiringRequestId: String(disputedEngagement._id), reason: 'I am not part of this case.' })
  assert.equal(outsider.status, 404)

  // Window boundary: 31-day-old engagement is closed, 29-day is fine.
  const windowClosedAttempt = await request(app)
    .post('/api/disputes')
    .set('Origin', origin)
    .set('Cookie', cookieB)
    .send({ hiringRequestId: String(refundCandidate._id).slice(0, -1), reason: 'Boundary probe.' })
  assert.ok([400, 404].includes(windowClosedAttempt.status))

  const opened = await request(app)
    .post('/api/disputes')
    .set('Origin', origin)
    .set('Cookie', cookieA)
    .send({ hiringRequestId: String(disputedEngagement._id), reason: 'Deliverables were never provided after payment.' })
  assert.equal(opened.status, 201)
  assert.equal(opened.body.data.dispute.status, 'open')

  const storedTxn = await PaymentTransaction.findById(disputedTxn._id)
  assert.equal(storedTxn.escrowStatus, 'disputed')
  const storedRequest = await HiringRequest.findById(disputedEngagement._id)
  assert.equal(storedRequest.disputeStatus, 'opened')

  // Concurrent second open loses the race against the partial unique index.
  const duplicateOpen = await request(app)
    .post('/api/disputes')
    .set('Origin', origin)
    .set('Cookie', cookieLawyer)
    .send({ hiringRequestId: String(disputedEngagement._id), reason: 'Client is mistaken about delivery.' })
  assert.equal(duplicateOpen.status, 409)
  assert.equal(duplicateOpen.body.error.code, 'DISPUTE_ALREADY_OPEN')

  // Confirm completion is blocked while the dispute is open.
  const blockedConfirm = await request(app)
    .post(`/api/cases/${disputedEngagement._id}/confirm-completion`)
    .set('Origin', origin)
    .set('Cookie', cookieA)
  assert.equal(blockedConfirm.status, 409)
  assert.equal(blockedConfirm.body.error.code, 'DISPUTE_OPEN')

  const adminList = await request(app).get('/api/admin/disputes?status=open').set('Cookie', cookieAdmin)
  assert.equal(adminList.status, 200)
  assert.equal(adminList.body.data.items.length, 1)
  assert.equal(adminList.body.data.items[0].engagement.specializationSnapshot, 'Family Law')

  const nonAdminResolve = await request(app)
    .patch(`/api/admin/disputes/${opened.body.data.dispute.id}/resolve`)
    .set('Origin', origin)
    .set('Cookie', cookieLawyer)
    .send({ outcome: 'refund', note: 'Not an admin.' })
  assert.equal(nonAdminResolve.status, 403)

  const shortNote = await request(app)
    .patch(`/api/admin/disputes/${opened.body.data.dispute.id}/resolve`)
    .set('Origin', origin)
    .set('Cookie', cookieAdmin)
    .send({ outcome: 'release', note: 'ok' })
  assert.equal(shortNote.status, 400)

  const resolvedRefund = await request(app)
    .patch(`/api/admin/disputes/${opened.body.data.dispute.id}/resolve`)
    .set('Origin', origin)
    .set('Cookie', cookieAdmin)
    .send({ outcome: 'refund', note: 'Verified non-delivery; full refund issued to the client.' })
  assert.equal(resolvedRefund.status, 200)
  assert.equal(resolvedRefund.body.data.dispute.status, 'resolved_refund')

  const refundedTxn = await PaymentTransaction.findById(disputedTxn._id)
  assert.equal(refundedTxn.status, 'refunded')
  assert.equal(refundedTxn.escrowStatus, 'refunded')
  assert.equal(refundedTxn.refundAmountMinor, 18000)
  const refundedRequest = await HiringRequest.findById(disputedEngagement._id)
  assert.equal(refundedRequest.disputeStatus, 'resolved')

  const doubleResolve = await request(app)
    .patch(`/api/admin/disputes/${opened.body.data.dispute.id}/resolve`)
    .set('Origin', origin)
    .set('Cookie', cookieAdmin)
    .send({ outcome: 'release', note: 'Trying again.' })
  assert.equal(doubleResolve.status, 409)
  assert.equal(doubleResolve.body.error.code, 'DISPUTE_ALREADY_RESOLVED')

  // Admin force-release on a plain held txn (29d-old refund candidate stays held — use its txn).
  const forceRelease = await request(app)
    .post(`/api/admin/transactions/${refundTxn._id}/release`)
    .set('Origin', origin)
    .set('Cookie', cookieAdmin)
    .send({ note: 'Client confirmed delivery out-of-band.' })
  assert.equal(forceRelease.status, 200)
  assert.equal(forceRelease.body.data.escrowStatus, 'released')
  const releasedTxn = await PaymentTransaction.findById(refundTxn._id)
  assert.equal(releasedTxn.releaseReason, 'admin')

  // My-disputes isolation for client A.
  const mineA = await request(app).get('/api/disputes/mine').set('Cookie', cookieA)
  assert.equal(mineA.body.data.items.length, 1)
  assert.equal(mineA.body.data.items[0].status, 'resolved_refund')
})

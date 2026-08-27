import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('consultation booking prevents conflicts and honours lawyer-only completion', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()

  const suffix = randomBytes(6).toString('hex')
  const emails = ['appt-lawyer', 'appt-client-a', 'appt-client-b'].map((local) => `${local}.${suffix}@legalease.test`)
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await mongoose.disconnect()
  })

  const [lawyer, clientA, clientB] = await Promise.all(emails.map((email) =>
    User.create({ fullName: `Appt ${email.split('.')[0]}`, email, passwordHash, role: email.startsWith('appt-lawyer') ? 'lawyer' : 'user', providers: ['local'] }),
  ))

  // Pick the next date that falls on a configured Tuesday-style weekday.
  const targetDayOfWeek = 2
  let dateKey
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = new Date(Date.now() + offset * 24 * 60 * 60 * 1000)
    if (candidate.getUTCDay() === targetDayOfWeek && candidate.getTime() > Date.now() + 12 * 60 * 60 * 1000) {
      dateKey = candidate.toISOString().slice(0, 10)
      break
    }
  }
  assert.ok(dateKey, 'fixture could not find a future matching weekday')

  const profile = await LawyerProfile.create({
    userId: lawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/appt-portrait.png',
    specialization: 'Corporate Law',
    bio: 'Contracts.',
    consultationFeeMinor: 30000,
    experienceYears: 9,
    licenseNumber: 'BAR-APPT-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
    availability: 'available',
    workingHours: [{ dayOfWeek: targetDayOfWeek, slots: [{ start: '10:00', end: '11:30' }] }],
  })

  function login(user) {
    return request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: sharedPassword })
  }

  const slotsPublic = await request(app).get(`/api/lawyers/${profile.id}/slots`).query({ dateKey })
  assert.equal(slotsPublic.status, 200)
  assert.deepEqual(slotsPublic.body.data.slots, ['10:00', '10:30', '11:00'])

  const cookieA = decodeURIComponent((await login(clientA)).headers['set-cookie'][0].split(';')[0])
  const cookieB = decodeURIComponent((await login(clientB)).headers['set-cookie'][0].split(';')[0])
  const cookieLawyer = decodeURIComponent((await login(lawyer)).headers['set-cookie'][0].split(';')[0])

  const unauthBook = await request(app).post('/api/appointments').set('Origin', origin).send({ lawyerProfileId: String(profile.id), dateKey, start: '10:00' })
  assert.equal(unauthBook.status, 401)

  const firstBooking = await request(app)
    .post('/api/appointments')
    .set('Origin', origin)
    .set('Cookie', cookieA)
    .send({ lawyerProfileId: String(profile.id), dateKey, start: '10:30' })
  assert.equal(firstBooking.status, 201)
  assert.equal(firstBooking.body.data.appointment.end, '11:00')

  const conflict = await request(app)
    .post('/api/appointments')
    .set('Origin', origin)
    .set('Cookie', cookieB)
    .send({ lawyerProfileId: String(profile.id), dateKey, start: '10:30' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'SLOT_UNAVAILABLE')

  const duplicateUpcoming = await request(app)
    .post('/api/appointments')
    .set('Origin', origin)
    .set('Cookie', cookieA)
    .send({ lawyerProfileId: String(profile.id), dateKey, start: '10:00' })
  assert.equal(duplicateUpcoming.status, 409)
  assert.equal(duplicateUpcoming.body.error.code, 'APPOINTMENT_EXISTS')

  const slotsAfterBooking = await request(app).get(`/api/lawyers/${profile.id}/slots`).query({ dateKey })
  assert.deepEqual(slotsAfterBooking.body.data.slots, ['10:00', '11:00'])

  const clientCancelForbidden = await request(app)
    .patch(`/api/appointments/${firstBooking.body.data.appointment.id}/complete`)
    .set('Origin', origin)
    .set('Cookie', cookieA)
  assert.equal(clientCancelForbidden.status, 404)
  assert.equal(clientCancelForbidden.body.error.code, 'APPOINTMENT_NOT_FOUND')

  const complete = await request(app)
    .patch(`/api/appointments/${firstBooking.body.data.appointment.id}/complete`)
    .set('Origin', origin)
    .set('Cookie', cookieLawyer)
  assert.equal(complete.status, 200)
  assert.equal(complete.body.data.status, 'completed')

  const freedSlot = await request(app)
    .post('/api/appointments')
    .set('Origin', origin)
    .set('Cookie', cookieB)
    .send({ lawyerProfileId: String(profile.id), dateKey, start: '10:30' })
  assert.equal(freedSlot.status, 201)

  const cancelledByClient = await request(app)
    .patch(`/api/appointments/${freedSlot.body.data.appointment.id}/cancel`)
    .set('Origin', origin)
    .set('Cookie', cookieB)
  assert.equal(cancelledByClient.status, 200)

  const busyCheck = await LawyerProfile.findByIdAndUpdate(profile.id, { availability: 'busy' }, { new: true })
  void busyCheck
  const slotsWhileBusy = await request(app).get(`/api/lawyers/${profile.id}/slots`).query({ dateKey })
  assert.equal(slotsWhileBusy.status, 404)
  assert.equal(slotsWhileBusy.body.error.code, 'LAWYER_NOT_FOUND')
})

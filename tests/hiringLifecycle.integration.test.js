import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI; const testDatabase = process.env.TEST_MONGODB_DB_NAME
test('hiring lifecycle integration', { skip: !(testUri && testDatabase?.endsWith('_test')) && 'Set isolated Atlas test variables.' }, async (context) => {
  process.env.NODE_ENV = 'test'; process.env.MONGODB_URI = testUri; process.env.MONGODB_DB_NAME = testDatabase; process.env.JWT_SECRET = randomBytes(48).toString('hex'); process.env.CLIENT_ORIGINS = 'http://localhost:5173'
  const [{ default: request }, mongoose, { default: app }, { User }, { LawyerProfile }, { HiringRequest }] = await Promise.all([import('supertest'), import('mongoose'), import('../src/app.js'), import('../src/models/User.js'), import('../src/models/LawyerProfile.js'), import('../src/models/HiringRequest.js')])
  await mongoose.connect(testUri, { dbName: testDatabase }); const label = `hiring-${randomBytes(5).toString('hex')}`; const emails = [`${label}-u@x.test`, `${label}-l@x.test`, `${label}-o@x.test`]
  context.after(async () => { const users = await User.find({ email: { $in: emails } }); await HiringRequest.deleteMany({ $or: [{ clientId: { $in: users } }, { lawyerId: { $in: users } }] }); await LawyerProfile.deleteMany({ userId: { $in: users } }); await User.deleteMany({ email: { $in: emails } }); await mongoose.disconnect() })
  const [user, lawyer, other] = await User.create([{ fullName: 'User One', email: emails[0], role: 'user' }, { fullName: 'Lawyer One', email: emails[1], role: 'lawyer' }, { fullName: 'Other Lawyer', email: emails[2], role: 'lawyer' }])
  const profile = await LawyerProfile.create({ userId: lawyer.id, professionalPhotoUrl: 'https://i.ibb.co/hire/a.png', specialization: 'Family Law', bio: 'Bio', consultationFeeMinor: 10000, experienceYears: 1, licenseNumber: 'L1', verificationStatus: 'paid', publicationStatus: 'published', availability: 'available' })
  const auth = (person) => request.agent(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: person.email, password: 'not-used' })
  const { createSessionToken } = await import('../src/utils/auth.js'); const cookie = (person) => `legalease_session=${createSessionToken(person)}`; const origin = 'http://localhost:5173'
  const create = () => request(app).post('/api/hiring-requests').set('Origin', origin).set('Cookie', cookie(user)).send({ lawyerProfileId: profile.id })
  const results = await Promise.all([create(), create()]); assert.equal(results.filter((result) => result.status === 201).length, 1); assert.equal(results.filter((result) => result.status === 409).length, 1)
  const item = (await request(app).get('/api/hiring-requests/mine').set('Cookie', cookie(user))).body.data.items[0]; assert.equal(item.feeMinorSnapshot, 10000); assert.equal(item.status, 'pending')
  await LawyerProfile.updateOne({ _id: profile.id }, { $set: { consultationFeeMinor: 20000 } }); assert.equal((await request(app).get('/api/hiring-requests/mine').set('Cookie', cookie(user))).body.data.items[0].feeMinorSnapshot, 10000)
  assert.equal((await request(app).patch(`/api/hiring-requests/${item.id}/decision`).set('Origin', origin).set('Cookie', cookie(other)).send({ decision: 'accepted' })).status, 404)
  assert.equal((await request(app).patch(`/api/hiring-requests/${item.id}/decision`).set('Origin', origin).set('Cookie', cookie(lawyer)).send({ decision: 'accepted' })).status, 200)
  const final = await HiringRequest.findById(item.id); assert.equal(final.status, 'accepted'); assert.equal(final.paymentStatus, 'unpaid'); assert.equal(final.paidAt, null); assert.equal((await request(app).patch(`/api/hiring-requests/${item.id}/decision`).set('Origin', origin).set('Cookie', cookie(lawyer)).send({ decision: 'rejected' })).status, 409)
})

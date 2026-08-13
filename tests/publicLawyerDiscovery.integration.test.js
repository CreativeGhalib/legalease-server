import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))

test('public lawyer discovery integration', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run public discovery integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = 'http://localhost:5173'

  const [{ default: request }, mongoose, { default: app }, { User }, { LawyerProfile }] = await Promise.all([
    import('supertest'), import('mongoose'), import('../src/app.js'), import('../src/models/User.js'), import('../src/models/LawyerProfile.js'),
  ])
  await mongoose.connect(testUri, { dbName: testDatabase })
  const label = `public-discovery-${randomBytes(6).toString('hex')}`
  const emails = Array.from({ length: 14 }, (_, index) => `${label}-${index}@legalease.test`)
  context.after(async () => {
    const users = await User.find({ email: { $in: emails } }).select('_id')
    await LawyerProfile.deleteMany({ userId: { $in: users.map((user) => user.id) } })
    await User.deleteMany({ email: { $in: emails } })
    await mongoose.disconnect()
  })

  const publicUsers = await User.create(Array.from({ length: 10 }, (_, index) => ({ fullName: `Public Family Lawyer ${index}`, email: emails[index], role: 'lawyer', status: 'active' })))
  const hiddenUsers = await User.create([
    { fullName: 'Draft Lawyer', email: emails[10], role: 'lawyer', status: 'active' },
    { fullName: 'Unpaid Lawyer', email: emails[11], role: 'lawyer', status: 'active' },
    { fullName: 'Deactivated Lawyer', email: emails[12], role: 'lawyer', status: 'deactivated' },
    { fullName: 'Not A Lawyer', email: emails[13], role: 'user', status: 'active' },
  ])
  const profileData = (userId, index, overrides = {}) => ({
    userId, professionalPhotoUrl: `https://i.ibb.co/public-${index}/portrait.png`, specialization: index % 2 ? 'Family Law' : 'Corporate Law', additionalSpecializations: ['Mediation'], bio: `Public professional profile ${index}`, consultationFeeMinor: 5000 + (index * 1000), experienceYears: index, licenseNumber: `LICENSE-${index}`, location: 'Dhaka', languages: ['Bangla', 'English'], availability: index % 2 ? 'available' : 'busy', verificationStatus: 'paid', publicationStatus: 'published', paidHireCount: index, ...overrides,
  })
  const publicProfiles = await LawyerProfile.create(publicUsers.map((user, index) => profileData(user.id, index)))
  await LawyerProfile.create([
    profileData(hiddenUsers[0].id, 10, { publicationStatus: 'draft' }),
    profileData(hiddenUsers[1].id, 11, { verificationStatus: 'unpaid' }),
    profileData(hiddenUsers[2].id, 12),
    profileData(hiddenUsers[3].id, 13),
  ])

  const firstPage = await request(app).get('/api/lawyers')
  assert.equal(firstPage.status, 200)
  assert.equal(firstPage.body.data.items.length, 8)
  assert.deepEqual(firstPage.body.meta, { page: 1, pageSize: 8, totalItems: 10, totalPages: 2 })
  assert.equal(firstPage.body.data.items.some((item) => item.fullName === 'Draft Lawyer'), false)
  assert.equal(firstPage.body.data.items.some((item) => Object.hasOwn(item, 'email') || Object.hasOwn(item, 'verificationStatus') || Object.hasOwn(item, 'tokenVersion')), false)

  const searched = await request(app).get('/api/lawyers?search=family%20lawyer%201&specialization=family%20law&minFee=60&maxFee=130&availability=available&sort=fee-low')
  assert.equal(searched.status, 200)
  assert.equal(searched.body.data.items.every((item) => item.specialization === 'Family Law' && item.availability === 'available'), true)
  assert.equal(searched.body.data.items[0]?.consultationFeeMinor >= 6000, true)

  const specialCharacters = await request(app).get('/api/lawyers?search=%5B%5E%5D.*')
  assert.equal(specialCharacters.status, 200)
  assert.equal(specialCharacters.body.meta.totalItems, 0)
  assert.equal((await request(app).get('/api/lawyers?sort=tokenVersion')).status, 400)
  assert.equal((await request(app).get('/api/lawyers?minFee=200&maxFee=100')).status, 400)
  assert.equal((await request(app).get('/api/lawyers?page=0')).status, 400)

  const featured = await request(app).get('/api/lawyers/featured')
  assert.equal(featured.status, 200)
  assert.equal(featured.body.data.items.length, 6)
  const top = await request(app).get('/api/lawyers/top')
  assert.equal(top.status, 200)
  assert.equal(top.body.data.items.length, 3)
  assert.equal(top.body.data.items[0].paidHireCount >= top.body.data.items[1].paidHireCount, true)

  const detail = await request(app).get(`/api/lawyers/${publicProfiles[0].id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.data.lawyer.id, publicProfiles[0].id)
  assert.equal((await request(app).get(`/api/lawyers/${publicProfiles[0].userId}`)).status, 404)
  assert.equal((await request(app).get('/api/lawyers/not-an-object-id')).status, 404)
})

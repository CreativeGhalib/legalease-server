import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('robots and sitemap expose only public surfaces with eligible lawyer URLs', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = testUri
  process.env.MONGODB_DB_NAME = testDatabase
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.CLIENT_ORIGINS = origin

  const [{ default: request }, mongoose, bcrypt, { default: app }, { User }, { LawyerProfile }, { resetSitemapCache }] = await Promise.all([
    import('supertest'),
    import('mongoose'),
    import('bcrypt'),
    import('../src/app.js'),
    import('../src/models/User.js'),
    import('../src/models/LawyerProfile.js'),
    import('../src/controllers/seoController.js'),
  ])

  await mongoose.connect(testUri, { dbName: testDatabase })
  await User.init()
  await LawyerProfile.init()
  resetSitemapCache()
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    resetSitemapCache()
    await mongoose.disconnect()
  })

  const suffix = randomBytes(6).toString('hex')
  const emails = ['seo-lawyer', 'seo-hidden-lawyer'].map((local) => `${local}.${suffix}@legalease.test`)
  const passwordHash = await bcrypt.hash(randomBytes(16).toString('base64url'), 12)
  await User.deleteMany({ email: { $in: emails } })

  const visibleLawyer = await User.create({ fullName: 'SEO Visible', email: lawyerEmail, role: 'lawyer', providers: ['local'], status: 'active' })
  const hiddenLawyer = await User.create({ fullName: 'SEO Hidden', email: hiddenEmail, role: 'lawyer', providers: ['local'], status: 'active' })

  await LawyerProfile.create({
    userId: visibleLawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/seo-visible.png',
    specialization: 'Criminal Law',
    bio: 'Visible practice.',
    consultationFeeMinor: 10000,
    experienceYears: 4,
    licenseNumber: 'BAR-SEO-V',
    verificationStatus: 'paid',
    publicationStatus: 'published',
  })
  await LawyerProfile.create({
    userId: hiddenLawyer.id,
    specialization: 'Hidden',
    consultationFeeMinor: 1000,
    publicationStatus: 'draft',
  })

  const robots = await request(app).get('/robots.txt')
  assert.equal(robots.status, 200)
  assert.match(robots.text, /Disallow: \/dashboard\//)
  assert.match(robots.text, /Sitemap: .*\/sitemap\.xml/)

  const sitemap = await request(app).get('/sitemap.xml')
  assert.equal(sitemap.status, 200)
  assert.match(sitemap.headers['content-type'], /application\/xml/)
  const eligibleProfileId = (await LawyerProfile.findOne({ publicationStatus: 'published' }))._id.toString()
  const draftProfileId = (await LawyerProfile.findOne({ publicationStatus: 'draft' }))._id.toString()

  assert.ok(sitemap.text.includes(`<loc>${origin}/lawyers/${eligibleProfileId}</loc>`))
  assert.ok(!sitemap.text.includes(String(draftProfileId)))
  assert.ok(sitemap.text.includes(`${origin}/lawyers/in/criminal-lawyer`))
  assert.ok(!sitemap.text.includes('/dashboard'))
})

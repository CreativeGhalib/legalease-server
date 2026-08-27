import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

const testUri = process.env.TEST_MONGODB_URI
const testDatabase = process.env.TEST_MONGODB_DB_NAME
const canRun = Boolean(testUri && testDatabase?.endsWith('_test'))
const origin = 'http://localhost:5173'

test('admin CSV exports stream dated attachments with injection-safe rows', { skip: !canRun && 'Set TEST_MONGODB_URI and a TEST_MONGODB_DB_NAME ending in _test to run database integration tests.' }, async (context) => {
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
  const emails = [`export-admin.${suffix}@legalease.test`, `=formula-lawyer.${suffix}@legalease.test`, `export-client.${suffix}@legalease.test`]
  const sharedPassword = randomBytes(16).toString('base64url')
  const passwordHash = await bcrypt.hash(sharedPassword, 12)
  await User.deleteMany({ email: { $in: emails } })
  context.after(async () => {
    await User.deleteMany({ email: { $in: emails } })
    await LawyerProfile.deleteMany({})
    await mongoose.disconnect()
  })

  const [admin, formulaLawyer] = await Promise.all(emails.slice(0, 2).map((email) =>
    User.create({ fullName: email.startsWith('=') ? '=EVIL FORMULA' : 'Export Admin', email, passwordHash, role: email.includes('admin') ? 'admin' : 'lawyer', providers: ['local'] }),
  ))
  const client = await User.create({ fullName: 'Export Client', email: emails[2], passwordHash, role: 'user', providers: ['local'] })

  await LawyerProfile.create({
    userId: formulaLawyer.id,
    professionalPhotoUrl: 'https://i.ibb.co/export-portrait.png',
    specialization: 'Tax Law',
    bio: 'Cross-border structuring.',
    consultationFeeMinor: 30000,
    experienceYears: 12,
    licenseNumber: 'BAR-CSV-001',
    verificationStatus: 'paid',
    publicationStatus: 'published',
    tier: 'silver',
  })

  const unauth = await request(app).get('/api/admin/users/export')
  assert.equal(unauth.status, 401)
  assert.equal(unauth.body.error.code, 'AUTHENTICATION_REQUIRED')

  const clientCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: emails[2], password: sharedPassword })).headers['set-cookie'][0].split(';')[0])
  const forbidden = await request(app).get('/api/admin/users/export').set('Cookie', clientCookie)
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.body.error.code, 'AUTHORIZATION_DENIED')

  const adminCookie = decodeURIComponent((await request(app).post('/api/auth/login').set('Origin', origin).send({ email: admin.email, password: sharedPassword })).headers['set-cookie'][0].split(';')[0])

  const usersCsv = await request(app).get('/api/admin/users/export').set('Cookie', adminCookie)
  assert.equal(usersCsv.status, 200)
  assert.match(usersCsv.headers['content-type'], /text\/csv/)
  assert.match(usersCsv.headers['content-disposition'], /attachment; filename="legalease-users-\d{4}-\d{2}-\d{2}\.csv"/)
  assert.equal(usersCsv.text.charCodeAt(0), 0xFEFF)
  assert.match(usersCsv.text, /^.*,fullName,email,role,status,createdAt/m)
  assert.ok(usersCsv.text.includes('=formula-lawyer'))
  assert.ok(usersCsv.text.includes("'=EVIL FORMULA"))

  const lawyersCsv = await request(app).get('/api/admin/lawyers/export?verificationStatus=paid').set('Cookie', adminCookie)
  assert.equal(lawyersCsv.status, 200)
  assert.match(lawyersCsv.text, /barAssociationBranch,tier,consultationFeeMinor,currency,availability,verificationStatus,publicationStatus,paidHireCount/)
  assert.ok(lawyersCsv.text.includes(',silver,'))

  const transactionsCsv = await request(app).get('/api/admin/transactions/export?status=paid').set('Cookie', adminCookie)
  assert.equal(transactionsCsv.status, 200)
  assert.match(transactionsCsv.text, /^.*type,payerName,lawyerName,/m)
})

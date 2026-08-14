import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../src/app.js'
import { env } from '../src/config/env.js'
import { authorizeRoles } from '../src/middleware/authorizeRoles.js'
import { roleSchema } from '../src/validators/adminValidators.js'
import { registerSchema } from '../src/validators/authValidators.js'
import { commentContentSchema } from '../src/validators/commentValidators.js'
import { googleCredentialSchema, googleOnboardingSchema } from '../src/validators/googleAuthValidators.js'
import { createHiringRequestSchema, hiringDecisionSchema } from '../src/validators/hiringRequestValidators.js'
import { lawyerProfileSchema } from '../src/validators/lawyerProfileValidators.js'
import { userProfileUpdateSchema } from '../src/validators/userProfileValidators.js'
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_DURATION_MS,
  verifySessionToken,
} from '../src/utils/auth.js'

test('hardening rejects oversized JSON, hostile origins, and operator-shaped public queries', async () => {
  const oversized = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send({ email: 'a@b.test', password: 'x'.repeat(110000) })
  assert.equal(oversized.status, 413)
  assert.equal(oversized.body.error.code, 'REQUEST_TOO_LARGE')
  const hostileOrigin = await request(app).get('/api/health').set('Origin', 'https://evil.example')
  assert.equal(hostileOrigin.status, 403)
  assert.equal(hostileOrigin.body.error.code, 'CORS_ORIGIN_DENIED')
  const operatorQuery = await request(app).get('/api/lawyers').query({ search: { $ne: 'law' } })
  assert.equal(operatorQuery.status, 400)
  assert.equal(operatorQuery.body.error.code, 'VALIDATION_ERROR')
})

test('protected route groups reject unauthenticated requests before database access', async () => {
  const responses = await Promise.all([
    request(app).get('/api/auth/me'),
    request(app).get('/api/users/me'),
    request(app).get('/api/lawyers/me/profile'),
    request(app).get('/api/hiring-requests/mine'),
    request(app).get('/api/payments/mine'),
    request(app).get('/api/comments/mine'),
    request(app).get('/api/admin/users'),
  ])

  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED')
  }
})

test('role middleware denies cross-role access and permits only an allowed current role', async () => {
  const authorize = (role, allowedRoles) => new Promise((resolve) => {
    authorizeRoles(...allowedRoles)({ auth: { user: { role } } }, {}, (error) => resolve(error ?? null))
  })

  assert.equal((await authorize('user', ['lawyer']))?.code, 'AUTHORIZATION_DENIED')
  assert.equal((await authorize('lawyer', ['admin']))?.code, 'AUTHORIZATION_DENIED')
  assert.equal((await authorize('user', ['admin']))?.code, 'AUTHORIZATION_DENIED')
  assert.equal(await authorize('admin', ['admin']), null)
})

test('public roles and writable payloads reject admin creation and protected-field assignment', () => {
  const registration = {
    fullName: 'Security Test User',
    email: 'security-test@legalease.test',
    password: 'a-secure-test-password',
    confirmPassword: 'a-secure-test-password',
  }

  assert.equal(registerSchema.safeParse({ ...registration, role: 'admin' }).success, false)
  assert.equal(googleCredentialSchema.safeParse({ credential: 'google-id-token', role: 'admin' }).success, false)
  assert.equal(googleOnboardingSchema.safeParse({ role: 'admin' }).success, false)
  assert.equal(userProfileUpdateSchema.safeParse({ fullName: 'Updated User', role: 'admin' }).success, false)
  assert.equal(lawyerProfileSchema.safeParse({ specialization: 'Family Law', userId: '507f1f77bcf86cd799439011' }).success, false)
  assert.equal(lawyerProfileSchema.safeParse({ paidHireCount: 999, verificationStatus: 'paid', publicationStatus: 'published' }).success, false)
  assert.equal(createHiringRequestSchema.safeParse({ lawyerProfileId: '507f1f77bcf86cd799439011', clientId: '507f191e810c19729de860ea' }).success, false)
  assert.equal(hiringDecisionSchema.safeParse({ decision: 'accepted', paymentStatus: 'paid' }).success, false)
  assert.equal(commentContentSchema.safeParse({ content: 'Valid comment', authorId: '507f191e810c19729de860ea' }).success, false)
  assert.equal(roleSchema.safeParse({ role: 'admin', status: 'active' }).success, false)
  assert.equal(createHiringRequestSchema.safeParse({ lawyerProfileId: { $ne: null } }).success, false)
})

test('LegalEase session token and cookie helpers enforce the seven-day server session contract', () => {
  const token = createSessionToken({ id: '507f1f77bcf86cd799439011', tokenVersion: 4 })
  const payload = verifySessionToken(token)
  const cookie = sessionCookieOptions()

  assert.equal(payload.sub, '507f1f77bcf86cd799439011')
  assert.equal(payload.tokenVersion, 4)
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60)
  assert.equal(SESSION_DURATION_MS, 7 * 24 * 60 * 60 * 1000)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'lax')
  assert.equal(cookie.path, '/')
  assert.throws(() => verifySessionToken('invalid.session.token'))
  const expiredToken = jwt.sign(
    { sub: '507f1f77bcf86cd799439011', tokenVersion: 4 },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: -1 },
  )
  assert.throws(() => verifySessionToken(expiredToken), { name: 'TokenExpiredError' })
})

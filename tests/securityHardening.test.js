import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import app from '../src/app.js'

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

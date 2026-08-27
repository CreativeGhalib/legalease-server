import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import app from '../src/app.js'
import { requestLogger } from '../src/middleware/requestLogger.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function runMiddleware(requestHeaders) {
  return new Promise((resolve) => {
    const request = { headers: requestHeaders, method: 'GET', path: '/probe', originalUrl: '/probe?x=1' }
    const response = {
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
    }
    requestLogger(request, response, () => resolve({ request, response }))
  })
}

test('requestLogger assigns a UUID when no trusted id header is present', async () => {
  const { request, response } = await runMiddleware({})
  assert.match(request.requestId, UUID_PATTERN)
  assert.equal(response.headers['x-request-id'], request.requestId)
})

test('requestLogger honors a well-formed inbound X-Request-ID and rejects hostile values', async () => {
  const honored = await runMiddleware({ 'x-request-id': 'client-provided-id-123' })
  assert.equal(honored.request.requestId, 'client-provided-id-123')

  const logInjection = await runMiddleware({ 'x-request-id': 'evil\n200 OK injected' })
  assert.notEqual(logInjection.request.requestId, 'evil\n200 OK injected')
  assert.match(logInjection.request.requestId, UUID_PATTERN)

  const oversized = await runMiddleware({ 'x-request-id': 'x'.repeat(500) })
  assert.match(oversized.request.requestId, UUID_PATTERN)
})

test('every API response carries a correlated X-Request-ID header and error body field', async () => {
  const healthy = await request(app).get('/api/health')
  assert.equal(healthy.status, 503)
  const healthyId = healthy.headers['x-request-id']
  assert.match(healthyId, UUID_PATTERN)

  const echoed = await request(app).get('/api/health').set('X-Request-ID', 'audit-trail-42')
  assert.equal(echoed.headers['x-request-id'], 'audit-trail-42')

  const missing = await request(app).get('/api/definitely-not-a-route')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.success, false)
  assert.equal(missing.body.requestId, missing.headers['x-request-id'])
  assert.match(missing.body.requestId, UUID_PATTERN)
})

test('health endpoints expose the same detailed readiness contract on legacy and v1 paths', async () => {
  const legacy = await request(app).get('/api/health')
  const versioned = await request(app).get('/api/v1/health')

  assert.equal(versioned.status, legacy.status)
  assert.equal(versioned.body.data.status, 'degraded')
  assert.equal(versioned.body.data.database.connected, false)
  assert.equal(versioned.body.data.database.state, 'disconnected')
  assert.equal(typeof versioned.body.data.database.latencyMs, 'number')
  assert.equal(typeof versioned.body.data.uptime, 'number')
  assert.equal(typeof versioned.body.data.memory.rss, 'number')
  assert.match(versioned.body.data.timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('v1 aliases preserve authentication behavior without removing legacy routes', async () => {
  const legacy = await request(app).get('/api/auth/me')
  const versioned = await request(app).get('/api/v1/auth/me')

  assert.equal(legacy.status, 401)
  assert.equal(versioned.status, 401)
  assert.equal(versioned.body.error.code, legacy.body.error.code)
})

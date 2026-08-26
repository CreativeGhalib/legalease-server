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
  assert.equal(healthy.status, 200)
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

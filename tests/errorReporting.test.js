import assert from 'node:assert/strict'
import test from 'node:test'
import { reportServerError } from '../src/utils/errorReporting.js'

test('server error reporting is a no-op unless SENTRY_DSN is configured', async () => {
  await assert.doesNotReject(() => reportServerError(new Error('probe'), { requestId: 'r-1' }))
})

test('errorHandler keeps its client contract intact while reporting 5xx failures', async () => {
  const { errorHandler } = await import('../src/middleware/errorHandler.js')
  const failure = Object.assign(new Error('boom for sentry probe'), { code: 'PROBE' })
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }

  await errorHandler(failure, { requestId: 'req-sentry', method: 'GET', path: '/probe' }, response, () => {})

  assert.equal(response.statusCode, 500)
  assert.equal(response.body.error.code, 'PROBE')
  assert.equal(response.body.requestId, 'req-sentry')
})

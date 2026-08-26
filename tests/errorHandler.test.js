import assert from 'node:assert/strict'
import test from 'node:test'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { logger } from '../src/config/logger.js'

function fakeResponse() {
  return {
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

function captureLoggerErrors(callback) {
  const original = logger.error
  const entries = []
  logger.error = (message, meta) => entries.push({ message, meta })
  try {
    callback()
  } finally {
    logger.error = original
  }
  return entries
}

test('errorHandler logs 5xx failures with request context via winston', () => {
  const failure = Object.assign(new Error('database exploded'), { code: 'DB_OUTAGE', stack: 'Error: database exploded' })

  const entries = captureLoggerErrors(() => {
    const response = fakeResponse()
    errorHandler(failure, { method: 'POST', path: '/api/probe' }, response, () => {})
    assert.equal(response.statusCode, 500)
    assert.deepEqual(response.body, {
      success: false,
      error: { code: 'DB_OUTAGE', message: 'database exploded' },
    })
  })

  assert.equal(entries.length, 1)
  assert.equal(entries[0].message, 'Unhandled server error')
  assert.equal(entries[0].meta.method, 'POST')
  assert.equal(entries[0].meta.path, '/api/probe')
  assert.equal(entries[0].meta.error, 'database exploded')
  assert.equal(entries[0].meta.code, 'DB_OUTAGE')
  assert.equal(entries[0].meta.stack, 'Error: database exploded')
})

test('errorHandler keeps client-facing error responses unchanged and skips logging for handled status codes', () => {
  const notFound = Object.assign(new Error('Missing record.'), { statusCode: 404, code: 'NOT_FOUND' })

  const entries = captureLoggerErrors(() => {
    const response = fakeResponse()
    errorHandler(notFound, { method: 'GET', path: '/api/nothing' }, response, () => {})
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.body, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Missing record.' },
    })
  })

  assert.equal(entries.length, 0)
})

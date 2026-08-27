import assert from 'node:assert/strict'
import test from 'node:test'
import { env } from '../src/config/env.js'
import { mongoRateLimitStore, RATE_LIMIT_COLLECTION, RateLimitMongoStore } from '../src/utils/rateLimitMongoStore.js'

test('rate limit store falls back to MemoryStore without a database URI', () => {
  const originalUri = env.MONGODB_URI
  delete env.MONGODB_URI
  try {
    assert.equal(mongoRateLimitStore('auth', 15 * 60 * 1000), undefined)
  } finally {
    if (originalUri) env.MONGODB_URI = originalUri
  }
})

test('rate limit store instances satisfy the express-rate-limit v8 contract with isolated prefixes', async () => {
  const originalUri = env.MONGODB_URI
  const originalEnvironment = env.NODE_ENV
  env.MONGODB_URI = 'mongodb://127.0.0.1:27017/legalease_rate_limit_store_test'
  env.NODE_ENV = 'test'
  try {
    const auth = new RateLimitMongoStore({ prefix: 'auth', windowMs: 15 * 60 * 1000 })
    const api = new RateLimitMongoStore({ prefix: 'api', windowMs: 60 * 1000 })

    assert.ok(auth instanceof RateLimitMongoStore)
    assert.equal(auth.windowMs, 15 * 60 * 1000)
    assert.equal(api.windowMs, 60 * 1000)
    assert.notEqual(auth.prefix, api.prefix)
    assert.equal(typeof auth.increment, 'function')
    assert.equal(typeof auth.decrement, 'function')
    assert.equal(typeof auth.resetKey, 'function')
    assert.equal(auth.localKeys, false)
    assert.equal(mongoRateLimitStore('auth', 15 * 60 * 1000), undefined)

    await assert.deepEqual(
      await new RateLimitMongoStore({ windowMs: 60_000, prefix: 'probe' }).increment('probe-key'),
      { totalHits: 1 },
    )
    assert.equal(RATE_LIMIT_COLLECTION, 'rateLimits')
    for (const prefix of ['auth', 'authStrict', 'api', 'upload', 'uploadMutation', 'checkout', 'adminMutation']) {
      assert.match(prefix, /^[a-zA-Z]+$/)
    }
  } finally {
    env.NODE_ENV = originalEnvironment
    if (originalUri) env.MONGODB_URI = originalUri
    else delete env.MONGODB_URI
  }
})

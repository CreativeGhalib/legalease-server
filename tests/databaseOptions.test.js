import assert from 'node:assert/strict'
import test from 'node:test'
import { env } from '../src/config/env.js'
import { connectionPoolOptions } from '../src/config/database.js'

test('mongoose connections use small serverless-safe pools with fast failure detection', () => {
  assert.deepEqual(connectionPoolOptions, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 10000,
    socketTimeoutMS: 45000,
  })

  const composed = { ...connectionPoolOptions, dbName: env.MONGODB_DB_NAME }
  assert.equal(composed.dbName, env.MONGODB_DB_NAME)
  assert.equal(Object.keys(composed).length, 5)
})

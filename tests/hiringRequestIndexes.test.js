import assert from 'node:assert/strict'
import test from 'node:test'
import { HiringRequest } from '../src/models/HiringRequest.js'

test('paid-hire reconciliation has a supporting compound index', () => {
  const indexes = HiringRequest.schema.indexes()
  const expected = { lawyerProfileId: 1, status: 1, paymentStatus: 1 }
  const matchingIndex = indexes.find(([fields]) => Object.keys(fields)[0] === 'lawyerProfileId' && Object.keys(fields).length === 3)

  assert.deepEqual(matchingIndex?.[0], expected)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  openDisputeSchema,
  resolveDisputeSchema,
  releaseOverrideSchema,
  disputesQuerySchema,
} from '../src/validators/disputeValidators.js'

test('dispute validators bound reasons, notes, outcomes, and list queries', () => {
  const base = { hiringRequestId: '507f1f77bcf86cd799439011' }
  assert.equal(openDisputeSchema.safeParse({ ...base, reason: 'Deliverables were never provided.' }).success, true)
  assert.equal(openDisputeSchema.safeParse({ ...base, reason: 'too short' }).success, false)
  assert.equal(openDisputeSchema.safeParse({ ...base, reason: 'x'.repeat(1001) }).success, false)
  assert.equal(openDisputeSchema.safeParse({ reason: 'Valid enough reason here.' }).success, false)
  assert.equal(openDisputeSchema.safeParse({ ...base, reason: 'Valid reason.', status: 'open' }).success, false)

  assert.equal(resolveDisputeSchema.safeParse({ outcome: 'refund', note: 'Verified non-delivery.' }).success, true)
  assert.equal(resolveDisputeSchema.safeParse({ outcome: 'release', note: 'ok' }).success, false)
  assert.equal(resolveDisputeSchema.safeParse({ outcome: 'cancel', note: 'Valid note length.' }).success, false)
  assert.equal(resolveDisputeSchema.safeParse({ outcome: 'refund' }).success, false)

  assert.equal(releaseOverrideSchema.safeParse({ note: 'Out-of-band confirmation.' }).success, true)
  assert.equal(releaseOverrideSchema.safeParse({}).success, false)

  const defaults = disputesQuerySchema.parse({})
  assert.deepEqual([defaults.page, defaults.limit, defaults.status], [1, 10, undefined])
  assert.equal(disputesQuerySchema.safeParse({ status: 'closed' }).success, false)
})

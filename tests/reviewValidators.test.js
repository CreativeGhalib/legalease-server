import assert from 'node:assert/strict'
import test from 'node:test'
import { createReviewSchema, publicReviewQuerySchema } from '../src/validators/reviewValidators.js'

test('review validators enforce integer 1-5 ratings and bounded feedback', () => {
  const base = { hiringRequestId: '507f1f77bcf86cd799439011' }
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 5 }).success, true)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: '4', feedback: 'Great advocacy.' }).success, true)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 0 }).success, false)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 6 }).success, false)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 4.5 }).success, false)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 5, feedback: 'x'.repeat(1001) }).success, false)
  assert.equal(createReviewSchema.safeParse({ ...base, rating: 5, status: 'paid' }).success, false)
  assert.equal(createReviewSchema.safeParse({}).success, false)

  assert.equal(publicReviewQuerySchema.safeParse({}).success, true)
  const defaults = publicReviewQuerySchema.parse({})
  assert.deepEqual([defaults.page, defaults.limit], [1, 5])
  assert.equal(publicReviewQuerySchema.safeParse({ page: 0 }).success, false)
  assert.equal(publicReviewQuerySchema.safeParse({ limit: 51 }).success, false)
})

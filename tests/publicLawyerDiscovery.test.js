import assert from 'node:assert/strict'
import test from 'node:test'
import { PUBLIC_PAGE_SIZE, escapeRegex, publicLawyerPipeline, publicLawyerProjection } from '../src/controllers/publicLawyerController.js'
import { publicLawyerQuerySchema } from '../src/validators/publicLawyerValidators.js'

test('public discovery query validation normalizes safe filters and fixed defaults', () => {
  const query = publicLawyerQuerySchema.parse({
    search: '  Family (law)  ', specialization: ' Family Law ', minFee: '50', maxFee: '125.50', availability: 'available', sort: 'fee-low', page: '2',
  })
  assert.deepEqual(query, { search: 'Family (law)', specialization: 'Family Law', minFee: 5000, maxFee: 12550, availability: 'available', sort: 'fee-low', page: 2 })
  assert.deepEqual(publicLawyerQuerySchema.parse({}), { sort: 'newest', page: 1 })
  assert.equal(PUBLIC_PAGE_SIZE, 8)
})

test('public discovery rejects unsafe or invalid query values', () => {
  for (const query of [
    { page: '0' }, { page: '-1' }, { page: '1.5' }, { sort: 'tokenVersion' }, { availability: 'free' },
    { minFee: '-1' }, { minFee: '100.999' }, { minFee: '200', maxFee: '100' }, { search: 'x'.repeat(101) },
    { $where: 'true' }, { search: ['lawyer'] },
  ]) assert.equal(publicLawyerQuerySchema.safeParse(query).success, false)
})

test('public discovery pipeline enforces eligibility, escaped server-side search, filters, and stable sort', () => {
  const { pipeline, sort } = publicLawyerPipeline({ search: 'A.*', specialization: 'Family Law', minFee: 5000, maxFee: 12550, availability: 'available', sort: 'most-hired' })
  assert.deepEqual(pipeline[0], { $match: { publicationStatus: 'published', verificationStatus: 'paid' } })
  assert.equal(pipeline[1].$lookup.from, 'users')
  assert.equal(pipeline[1].$lookup.pipeline[0].$match.$expr.$and.length, 3)
  assert.equal(pipeline[3].$match.$and[0].$or[0]['lawyerUser.fullName'].source, 'A\\.\\*')
  assert.deepEqual(sort, { paidHireCount: -1, createdAt: -1, _id: -1 })
  assert.deepEqual(publicLawyerPipeline({ sort: 'newest' }).sort, { createdAt: -1, _id: -1 })
  assert.deepEqual(publicLawyerPipeline({ sort: 'fee-low' }).sort, { consultationFeeMinor: 1, _id: 1 })
  assert.deepEqual(publicLawyerPipeline({ sort: 'fee-high' }).sort, { consultationFeeMinor: -1, _id: -1 })
  assert.equal(escapeRegex('a+b?'), 'a\\+b\\?')
})

test('public lawyer projection is explicitly safe', () => {
  for (const key of ['passwordHash', 'email', 'googleSub', 'providers', 'tokenVersion', 'verificationPaidAt', 'verificationStatus', 'publicationStatus', 'userId']) {
    assert.equal(Object.hasOwn(publicLawyerProjection, key), false)
  }
  assert.equal(publicLawyerProjection.id, '$_id')
  assert.equal(publicLawyerProjection.joinedAt, '$lawyerUser.createdAt')
})

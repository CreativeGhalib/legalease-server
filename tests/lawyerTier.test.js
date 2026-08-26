import assert from 'node:assert/strict'
import test from 'node:test'
import { lawyerProfileSchema } from '../src/validators/lawyerProfileValidators.js'
import { tierSchema } from '../src/validators/adminValidators.js'
import { publicLawyerProjection } from '../src/controllers/publicLawyerController.js'

test('trust tiers are admin-only and branch edits stay lawyer-editable', () => {
  const base = { specialization: 'Family Law', licenseNumber: 'BAR-12345' }

  assert.equal(lawyerProfileSchema.safeParse({ ...base, barAssociationBranch: 'Dhaka Bar Association' }).success, true)
  assert.equal(lawyerProfileSchema.safeParse({ ...base, barAssociationBranch: '' }).success, true)
  assert.equal(lawyerProfileSchema.safeParse({ ...base, barAssociationBranch: 'x'.repeat(121) }).success, false)

  assert.equal(lawyerProfileSchema.safeParse({ ...base, tier: 'gold' }).success, false)
  assert.equal(tierSchema.safeParse({ tier: 'silver' }).success, true)
  assert.equal(tierSchema.safeParse({ tier: 'platinum' }).success, false)
  assert.equal(tierSchema.safeParse({ tier: 'gold', status: 'active' }).success, false)
})

test('public projection and safe DTO surface expose tier and branch fields only', () => {
  for (const key of ['tier', 'barAssociationBranch']) {
    assert.ok(Object.prototype.hasOwnProperty.call(publicLawyerProjection, key))
  }
  assert.equal(publicLawyerProjection.passwordHash, undefined)
})

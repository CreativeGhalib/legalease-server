import assert from 'node:assert/strict'
import test from 'node:test'
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '../src/validators/authValidators.js'

test('password reset validators enforce shape and the twelve-character policy', () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: 'user@legalease.test' }).success, true)
  assert.equal(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success, false)
  assert.equal(forgotPasswordSchema.safeParse({}).success, false)
  assert.equal(forgotPasswordSchema.safeParse({ email: 'user@legalease.test', extra: true }).success, false)

  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'exactly-12-characters' }).success, true)
  assert.equal(resetPasswordSchema.safeParse({ token: '', password: 'exactly-12-characters' }).success, false)
  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'short12char' }).success, false)
  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64) }).success, false)
  assert.equal(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'exactly-12-characters', extra: 1 }).success, false)

  assert.equal(changePasswordSchema.safeParse({ currentPassword: 'current-value-1', newPassword: 'exactly-12-characters' }).success, true)
  assert.equal(changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'exactly-12-characters' }).success, false)
  assert.equal(changePasswordSchema.safeParse({ currentPassword: 'current-value-1', newPassword: 'short12char' }).success, false)
  assert.equal(changePasswordSchema.safeParse({ newPassword: 'exactly-12-characters' }).success, false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIT_ACTIONS } from '../src/services/auditService.js'

test('audit action names are unique, lowercase dot-namespaced strings', () => {
  const values = Object.values(AUDIT_ACTIONS)
  assert.equal(new Set(values).size, values.length)
  for (const value of values) {
    assert.match(value, /^[a-z0-9_.]+$/)
    assert.ok(value.length <= 60)
  }
  assert.equal(AUDIT_ACTIONS.TIER_CHANGE, 'tier.change')
  assert.equal(AUDIT_ACTIONS.ESCROW_CLIENT_CONFIRMED, 'escrow.client_confirmed')
})

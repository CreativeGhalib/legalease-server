import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeRoles } from '../src/middleware/authorizeRoles.js'

const allowed = (role, ...roles) => new Promise((resolve) => {
  authorizeRoles(...roles)({ auth: { user: { role } } }, {}, (error) => resolve(error?.code ?? 'ALLOWED'))
})

test('authorizeRoles accepts normalized role values', async () => {
  assert.equal(await allowed('lawyer', 'lawyer'), 'ALLOWED')
  assert.equal(await allowed(' Lawyer ', 'lawyer'), 'ALLOWED')
  assert.equal(await allowed('ADMIN', 'admin'), 'ALLOWED')
  assert.equal(await allowed('user', 'admin'), 'AUTHORIZATION_DENIED')
})

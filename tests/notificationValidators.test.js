import assert from 'node:assert/strict'
import test from 'node:test'
import { notificationQuerySchema } from '../src/validators/notificationValidators.js'

test('notification query defaults to newest-first page of 10 and supports unread filtering', () => {
  const defaults = notificationQuerySchema.parse({})
  assert.deepEqual([defaults.page, defaults.limit, defaults.unread], [1, 10, false])

  const filtered = notificationQuerySchema.parse({ page: '2', limit: '25', unread: 'true' })
  assert.equal(filtered.unread, true)
  assert.equal(filtered.page, 2)

  assert.equal(notificationQuerySchema.safeParse({ limit: 51 }).success, false)
  assert.equal(notificationQuerySchema.safeParse({ unread: 'maybe' }).success, false)
  assert.equal(notificationQuerySchema.safeParse({ userId: '507f1f77bcf86cd799439011' }).success, false)
})

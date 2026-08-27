import assert from 'node:assert/strict'
import test from 'node:test'
import { createLeadSchema, leadNoteSchema, leadQuerySchema, leadStatusSchema } from '../src/validators/leadValidators.js'

test('lead capture accepts supported sources and rejects malformed or unknown input', () => {
  assert.equal(createLeadSchema.safeParse({ name: 'Amina Rahman', phone: '+880 1712-345678', legalIssue: 'I need help with a property dispute.', source: 'hero' }).success, true)
  assert.equal(createLeadSchema.safeParse({ name: 'A', phone: 'not-a-phone', source: 'unknown' }).success, false)
  assert.equal(createLeadSchema.safeParse({ name: 'Amina Rahman', phone: '+8801712345678', source: 'callback', role: 'admin' }).success, false)
})

test('admin lead filters, status changes, and notes are bounded', () => {
  assert.equal(leadQuerySchema.safeParse({ status: 'new', source: 'exit_intent', dateFrom: '2026-08-01', page: '2' }).success, true)
  assert.equal(leadQuerySchema.safeParse({ dateFrom: 'yesterday' }).success, false)
  assert.equal(leadStatusSchema.safeParse({ status: 'converted' }).success, true)
  assert.equal(leadStatusSchema.safeParse({ status: 'deleted' }).success, false)
  assert.equal(leadNoteSchema.safeParse({ note: 'Called and scheduled follow-up.' }).success, true)
  assert.equal(leadNoteSchema.safeParse({ note: 'x'.repeat(1001) }).success, false)
})

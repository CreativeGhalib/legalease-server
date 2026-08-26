import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHireExpiredEmail } from '../src/services/emailService.js'
import { HiringRequest } from '../src/models/HiringRequest.js'

test('new hiring requests carry a 48-hour deadline while legacy rows stay grandfathered', () => {
  const doc = new HiringRequest({})
  assert.equal(doc.expiresAt, null)
  assert.ok(doc.schema.path('status').enumValues.includes('expired'))
  const schemaExpires = doc.schema.path('expiresAt')
  assert.equal(schemaExpires.options.default, null)
})

test('expiry notification template targets the client with mandatory footer and 48h wording', () => {
  const client = { fullName: 'Nasrin Begum', email: 'nasrin@legalease.test' }
  const lawyer = { fullName: 'Adv. Rahim Ahmed', email: 'rahim@legalease.test' }
  const request = { specializationSnapshot: 'Criminal Law' }

  const payload = buildHireExpiredEmail(client, lawyer, request)
  assert.equal(payload.to, 'nasrin@legalease.test')
  assert.match(payload.subject, /expired/i)
  assert.match(payload.html, /Adv\. Rahim Ahmed/)
  assert.match(payload.html, /48 hours/)
  assert.match(payload.html, /LegalEase, Dhaka, Bangladesh/)
  assert.match(payload.html, /\/unsubscribe/)
})

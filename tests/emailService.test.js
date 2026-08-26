import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHireDecisionEmail,
  buildHireRequestEmail,
  buildPaymentConfirmationEmail,
  buildProfilePublishedEmail,
} from '../src/services/emailService.js'
import { transporter, sendMail } from '../src/config/mailer.js'

const lawyer = { fullName: 'Adv. Rahim Ahmed', email: 'rahim@legalease.test' }
const client = { fullName: 'Nasrin Begum', email: 'nasrin@legalease.test' }
const hiringRequest = { specializationSnapshot: 'Criminal Law', feeMinorSnapshot: 123456, currency: 'USD' }

test('every notification template carries the mandatory unsubscribe link and physical address footer', () => {
  const payloads = [
    buildHireRequestEmail(lawyer, client, hiringRequest),
    buildHireDecisionEmail(client, lawyer, 'accepted'),
    buildHireDecisionEmail(client, lawyer, 'rejected'),
    ...buildPaymentConfirmationEmail(client, lawyer, 5000),
    buildProfilePublishedEmail(lawyer),
  ]

  assert.equal(payloads.length, 6)
  for (const payload of payloads) {
    assert.ok(payload.to, 'template must target a recipient')
    assert.ok(payload.subject.length > 0)
    assert.match(payload.html, /href="[^"]*\/unsubscribe"/)
    assert.match(payload.html, /LegalEase, Dhaka, Bangladesh/)
  }
})

test('hire request and decision templates reflect the correct parties, amounts, and outcomes', () => {
  const request = buildHireRequestEmail(lawyer, client, hiringRequest)
  assert.equal(request.to, 'rahim@legalease.test')
  assert.match(request.subject, /Nasrin Begum/)
  assert.match(request.html, /Criminal Law/)

  const accepted = buildHireDecisionEmail(client, lawyer, 'accepted')
  const rejected = buildHireDecisionEmail(client, lawyer, 'rejected')
  assert.equal(accepted.to, 'nasrin@legalease.test')
  assert.notEqual(accepted.subject, rejected.subject)
  assert.match(accepted.html, /accepted your request|accepted/)
  assert.match(rejected.html, /unable to take this matter/)

  const [clientReceipt, lawyerNotice] = buildPaymentConfirmationEmail(client, lawyer, 123456)
  assert.equal(clientReceipt.to, 'nasrin@legalease.test')
  assert.equal(lawyerNotice.to, 'rahim@legalease.test')
  assert.match(clientReceipt.html, /\$1,234\.56/)
})

test('mailer degrades gracefully when SMTP is unconfigured and never throws on dispatch', async () => {
  assert.equal(transporter, null)
  await assert.doesNotReject(() => sendMail('someone@legalease.test', 'Probe subject', '<p>probe</p>'))
  await assert.doesNotReject(() => sendMail(undefined, 'No recipient', '<p>noop</p>'))
})

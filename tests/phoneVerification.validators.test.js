import assert from 'node:assert/strict'
import test from 'node:test'
import { sendPhoneOtpSchema, verifyPhoneOtpSchema } from '../src/validators/authValidators.js'

test('phone verification accepts Bangladesh mobile formats and exact six-digit codes', () => {
  for (const phone of ['01712345678', '+8801712345678', '8801712345678']) {
    assert.equal(sendPhoneOtpSchema.safeParse({ phone }).success, true)
  }
  assert.equal(sendPhoneOtpSchema.safeParse({ phone: '+12025550123' }).success, false)
  assert.equal(verifyPhoneOtpSchema.safeParse({ code: '012345' }).success, true)
  assert.equal(verifyPhoneOtpSchema.safeParse({ code: '12345' }).success, false)
})

import crypto from 'node:crypto'
import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { sendSms } from '../services/smsService.js'

const OTP_TTL_MS = 10 * 60 * 1000

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function normalizePhone(value) {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('880')) return `+${digits}`
  if (digits.startsWith('0')) return `+88${digits}`
  return `+${digits}`
}

function otpHash(userId, phone, code) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${userId}:${phone}:${code}`).digest('hex')
}

export async function sendPhoneOtp(request, response, next) {
  try {
    const phone = normalizePhone(request.body.phone)
    const existing = await User.exists({ phone, _id: { $ne: request.auth.user.id } })
    if (existing) throw fail('This phone number is already verified by another account.', 409, 'PHONE_ALREADY_USED')

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    await sendSms(phone, `Your LegalEase verification code is ${code}. It expires in 10 minutes.`)
    await User.updateOne({ _id: request.auth.user.id }, {
      $set: {
        pendingPhone: phone,
        phoneOtpHash: otpHash(request.auth.user.id, phone, code),
        phoneOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        phoneOtpAttempts: 0,
      },
    })
    return response.json({ success: true, data: { phone, expiresInSeconds: OTP_TTL_MS / 1000 } })
  } catch (error) {
    return next(error)
  }
}

export async function verifyPhoneOtp(request, response, next) {
  try {
    const user = await User.findById(request.auth.user.id).select('+phoneOtpHash +phoneOtpExpiresAt +phoneOtpAttempts +pendingPhone')
    if (!user?.pendingPhone || !user.phoneOtpHash || !user.phoneOtpExpiresAt || user.phoneOtpExpiresAt <= new Date()) {
      throw fail('The verification code expired. Request a new one.', 400, 'PHONE_OTP_EXPIRED')
    }
    if (user.phoneOtpAttempts >= 5) throw fail('Too many incorrect codes. Request a new one.', 429, 'PHONE_OTP_ATTEMPTS_EXCEEDED')

    const candidate = otpHash(user.id, user.pendingPhone, request.body.code)
    const valid = crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.phoneOtpHash, 'hex'))
    if (!valid) {
      user.phoneOtpAttempts += 1
      await user.save()
      throw fail('The verification code is incorrect.', 400, 'PHONE_OTP_INVALID')
    }

    const alreadyUsed = await User.exists({ phone: user.pendingPhone, _id: { $ne: user._id } })
    if (alreadyUsed) throw fail('This phone number is already verified by another account.', 409, 'PHONE_ALREADY_USED')
    user.phone = user.pendingPhone
    user.phoneVerified = true
    user.pendingPhone = null
    user.phoneOtpHash = null
    user.phoneOtpExpiresAt = null
    user.phoneOtpAttempts = 0
    await user.save()
    return response.json({ success: true, data: { phone: user.phone, phoneVerified: true } })
  } catch (error) {
    return next(error)
  }
}

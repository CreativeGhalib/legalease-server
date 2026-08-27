import { env } from '../config/env.js'

function unavailable() {
  return Object.assign(new Error('SMS verification is not configured.'), { statusCode: 503, code: 'SMS_UNAVAILABLE' })
}

export async function sendSms(to, text) {
  if (!env.VONAGE_API_KEY || !env.VONAGE_API_SECRET || !env.VONAGE_FROM_NUMBER) throw unavailable()
  const response = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_key: env.VONAGE_API_KEY,
      api_secret: env.VONAGE_API_SECRET,
      from: env.VONAGE_FROM_NUMBER,
      to,
      text,
    }),
  })
  const payload = await response.json().catch(() => null)
  const message = payload?.messages?.[0]
  if (!response.ok || message?.status !== '0') {
    throw Object.assign(new Error('SMS delivery failed.'), { statusCode: 502, code: 'SMS_DELIVERY_FAILED' })
  }
}

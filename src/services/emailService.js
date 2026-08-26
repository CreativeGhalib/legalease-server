import { env } from '../config/env.js'
import { sendMail } from '../config/mailer.js'

const BRAND_BASE_URL = () => env.clientOrigins[0] ?? 'https://legalease-sand.vercel.app'

function money(amountMinor, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100)
}

function renderEmail({ title, bodyHtml }) {
  const baseUrl = BRAND_BASE_URL()
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background-color:#f2ece0;font-family:Arial,Helvetica,sans-serif;color:#0c1827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background-color:#fdf9f2;border-radius:12px;border:1px solid #d8ccb8;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:13px;font-weight:bold;letter-spacing:2px;color:#1b3a6b;">LEGALEASE</p>
          <h1 style="margin:14px 0 0;font-size:22px;line-height:1.3;">${title}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 32px 4px;font-size:15px;line-height:1.6;">${bodyHtml}</td>
      </tr>
      <tr>
        <td style="padding:20px 32px 26px;">
          <hr style="border:none;border-top:1px solid #e4d9c5;margin:0 0 16px;" />
          <p style="margin:0 0 8px;font-size:12px;color:#69798e;">You are receiving this message because you have a LegalEase account.</p>
          <p style="margin:0;font-size:12px;color:#69798e;">
            <a href="${baseUrl}/unsubscribe" style="color:#1b3a6b;">Unsubscribe</a>
            &nbsp;·&nbsp; LegalEase, Dhaka, Bangladesh
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function buildHireRequestEmail(lawyer, client, hiringRequest) {
  return {
    to: lawyer.email,
    subject: `New hire request from ${client.fullName} — LegalEase`,
    html: renderEmail({
      title: 'You have a new hire request',
      bodyHtml: `<p>${client.fullName} (${client.email}) requested your legal services for <strong>${hiringRequest.specializationSnapshot}</strong>.</p>
<p>Consultation fee snapshot: <strong>${money(hiringRequest.feeMinorSnapshot, hiringRequest.currency)}</strong>. Review and accept or reject the request from your dashboard.</p>`,
    }),
  }
}

export function buildHireDecisionEmail(client, lawyer, decision) {
  const accepted = decision === 'accepted'
  return {
    to: client.email,
    subject: `Your hire request was ${decision} — LegalEase`,
    html: renderEmail({
      title: accepted ? 'Your hire request was accepted' : 'Your hire request was rejected',
      bodyHtml: accepted
        ? `<p><strong>${lawyer.fullName}</strong> accepted your request. You can now pay the consultation fee securely from your dashboard to confirm the engagement.</p>`
        : `<p><strong>${lawyer.fullName}</strong> is unable to take this matter. You can send a new request to another lawyer at any time.</p>`,
    }),
  }
}

export function buildPaymentConfirmationEmail(client, lawyer, amountMinor, currency = 'USD') {
  const amount = money(amountMinor, currency)
  return [
    {
      to: client.email,
      subject: `Payment of ${amount} confirmed — LegalEase`,
      html: renderEmail({
        title: 'Your payment is confirmed',
        bodyHtml: `<p>Your payment of <strong>${amount}</strong> to <strong>${lawyer.fullName}</strong> has been verified. Your engagement is active and visible in your dashboard history.</p>`,
      }),
    },
    {
      to: lawyer.email,
      subject: `Payment of ${amount} received — LegalEase`,
      html: renderEmail({
        title: 'A payment was made to you',
        bodyHtml: `<p><strong>${client.fullName}</strong> paid the consultation fee of <strong>${amount}</strong> for your accepted engagement.</p>`,
      }),
    },
  ]
}

export function buildProfilePublishedEmail(lawyer) {
  return {
    to: lawyer.email,
    subject: 'Your profile is live on LegalEase',
    html: renderEmail({
      title: 'Your profile is now public',
      bodyHtml: `<p>Congratulations ${lawyer.fullName} — your professional profile is published on LegalEase and discoverable by clients searching your practice areas.</p>`,
    }),
  }
}

export function buildHireExpiredEmail(client, lawyer, hiringRequest) {
  return {
    to: client.email,
    subject: 'Your hire request expired without a response — LegalEase',
    html: renderEmail({
      title: 'Your hire request has expired',
      bodyHtml: `<p>Your request to <strong>${lawyer.fullName}</strong> for <strong>${hiringRequest.specializationSnapshot}</strong> was automatically closed after 48 hours without a decision. You can send a new request to any available lawyer at any time.</p>`,
    }),
  }
}

async function deliver(payload) {
  if (!payload) return
  await sendMail(payload.to, payload.subject, payload.html)
}

export async function sendHireRequestEmail(lawyer, client, hiringRequest) {
  await deliver(buildHireRequestEmail(lawyer, client, hiringRequest))
}

export async function sendHireDecisionEmail(client, lawyer, decision) {
  await deliver(buildHireDecisionEmail(client, lawyer, decision))
}

export async function sendPaymentConfirmationEmail(client, lawyer, amountMinor, currency) {
  const payloads = buildPaymentConfirmationEmail(client, lawyer, amountMinor, currency)
  for (const payload of payloads) await deliver(payload)
}

export async function sendProfilePublishedEmail(lawyer) {
  await deliver(buildProfilePublishedEmail(lawyer))
}

export async function sendHireExpiredEmail(client, lawyer, hiringRequest) {
  await deliver(buildHireExpiredEmail(client, lawyer, hiringRequest))
}

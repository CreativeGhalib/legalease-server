import nodemailer from 'nodemailer'
import { env } from './env.js'
import { logger } from './logger.js'

export const DEFAULT_FROM = 'LegalEase <noreply@legalease.com.bd>'

export const isMailerConfigured = Boolean(
  env.EMAIL_HOST && env.EMAIL_PORT && env.EMAIL_USER && env.EMAIL_PASS,
)

export const transporter = isMailerConfigured
  ? nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_PORT === 465,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    })
  : null

export async function sendMail(to, subject, html) {
  if (!to) return
  if (!transporter) {
    logger.info(`Email skipped (mailer unconfigured): to=${to} subject="${subject}"`)
    return
  }
  try {
    await transporter.sendMail({ from: env.EMAIL_FROM ?? DEFAULT_FROM, to, subject, html })
  } catch (error) {
    logger.error('Email dispatch failed.', { error: error.message, to })
  }
}

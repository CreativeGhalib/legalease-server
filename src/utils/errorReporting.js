import { env } from '../config/env.js'

let sentryPromise = null

async function loadSentry() {
  if (!sentryPromise) {
    sentryPromise = import('@sentry/node').catch((error) => {
      sentryPromise = null
      throw error
    })
  }
  return sentryPromise
}

/**
 * Optional Sentry capture for 5xx failures. No-ops unless SENTRY_DSN is
 * configured; never throws into the error pipeline.
 */
export async function reportServerError(error, context = {}) {
  if (!env.SENTRY_DSN) return
  try {
    const Sentry = await loadSentry()
    if (!sentryInitialized) {
      Sentry.init({ dsn: env.SENTRY_DSN, sendDefaultPii: false })
      sentryInitialized = true
    }
    Sentry.captureException(error, { extra: context })
  } catch (cause) {
    void cause
  }
}


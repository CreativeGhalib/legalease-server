import { rateLimit } from 'express-rate-limit'
import { mongoRateLimitStore } from '../utils/rateLimitMongoStore.js'

const WINDOW_MS = 15 * 60 * 1000

function mutationLimit(prefix, limit, code, message) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: mongoRateLimitStore(prefix, WINDOW_MS),
    message: { success: false, error: { code, message } },
  })
}

export const authRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: mongoRateLimitStore('authStrict', WINDOW_MS),
  message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } },
})

export const checkoutRateLimit = mutationLimit('checkout', 12, 'CHECKOUT_RATE_LIMITED', 'Too many payment attempts. Please try again later.')
export const intakeRateLimit = mutationLimit('intake', 10, 'INTAKE_RATE_LIMITED', 'Too many AI intake requests. Please try again in a few minutes.')
export const ipnRateLimit = mutationLimit('sslcommerzIpn', 120, 'IPN_RATE_LIMITED', 'Too many gateway callbacks. Please retry shortly.')
export const uploadRateLimit = mutationLimit('uploadMutation', 30, 'UPLOAD_RATE_LIMITED', 'Too many upload attempts. Please try again later.')
export const adminMutationRateLimit = mutationLimit('adminMutation', 60, 'ADMIN_MUTATION_RATE_LIMITED', 'Too many administration changes. Please try again later.')

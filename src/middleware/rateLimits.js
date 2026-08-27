/**
 * Centralized rate limiting configuration (H-11).
 * Single source of truth for ALL rate limiters — previously split across
 * rateLimiter.js (global) and rateLimits.js (route-level). Merged here.
 *
 * Strategy:
 *  - apiLimiter: broad DDoS guard (120 req/min) — applied globally on /api
 *  - authLimiter: brute-force guard (10 req/15min) — applied on /api/auth
 *  - uploadLimiter: storage abuse guard (10 req/hr) — applied on /api/uploads
 *  - Route-level limiters for mutations (checkout, IPN, admin, intake, lead)
 */
import rateLimit from 'express-rate-limit'
import { mongoRateLimitStore } from '../utils/rateLimitMongoStore.js'

const AUTH_WINDOW_MS = 15 * 60 * 1000    // 15 minutes
const API_WINDOW_MS = 60 * 1000          // 1 minute
const UPLOAD_WINDOW_MS = 60 * 60 * 1000  // 1 hour
const MUTATION_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// ── Global limiters (applied in app.js) ─────────────────────────────────────

/**
 * General API limiter — broad DDoS guard.
 * 120 requests per minute per IP.
 */
export const apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: mongoRateLimitStore('api', API_WINDOW_MS),
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests from this IP. Please slow down.' } },
})

/**
 * Auth endpoint limiter — brute-force and credential stuffing guard.
 * 10 attempts per 15 minutes per IP. Only counts failed attempts.
 */
export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: mongoRateLimitStore('auth', AUTH_WINDOW_MS),
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many attempts from this IP. Please try again in 15 minutes.' } },
})

/**
 * Upload endpoint limiter — storage abuse guard.
 * 10 uploads per hour per IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: UPLOAD_WINDOW_MS,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: mongoRateLimitStore('upload', UPLOAD_WINDOW_MS),
  message: { success: false, error: { code: 'UPLOAD_RATE_LIMITED', message: 'Upload limit reached. Please try again in an hour.' } },
})

// ── Route-level mutation limiters ────────────────────────────────────────────

function mutationLimit(prefix, limit, code, message) {
  return rateLimit({
    windowMs: MUTATION_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: mongoRateLimitStore(prefix, MUTATION_WINDOW_MS),
    message: { success: false, error: { code, message } },
  })
}

// Strict auth mutations (password reset, OTP, etc.)
export const authRateLimit = mutationLimit('authStrict', 10, 'AUTH_RATE_LIMITED', 'Too many authentication attempts. Please try again later.')

// Payment checkout initiation
export const checkoutRateLimit = mutationLimit('checkout', 12, 'CHECKOUT_RATE_LIMITED', 'Too many payment attempts. Please try again later.')

// AI intake form
export const intakeRateLimit = mutationLimit('intake', 10, 'INTAKE_RATE_LIMITED', 'Too many AI intake requests. Please try again in a few minutes.')

// Callback lead capture
export const leadRateLimit = mutationLimit('lead', 10, 'LEAD_RATE_LIMITED', 'Too many callback requests. Please try again later.')

// SSLCommerz IPN callbacks (gateway → server, higher limit)
export const ipnRateLimit = mutationLimit('sslcommerzIpn', 120, 'IPN_RATE_LIMITED', 'Too many gateway callbacks. Please retry shortly.')

// File upload mutations
export const uploadRateLimit = mutationLimit('uploadMutation', 30, 'UPLOAD_RATE_LIMITED', 'Too many upload attempts. Please try again later.')

// Admin write operations
export const adminMutationRateLimit = mutationLimit('adminMutation', 60, 'ADMIN_MUTATION_RATE_LIMITED', 'Too many administration changes. Please try again later.')

import rateLimit from 'express-rate-limit'
import { mongoRateLimitStore } from '../utils/rateLimitMongoStore.js'

/**
 * Strict limiter for auth endpoints — prevents brute-force and credential stuffing.
 * 10 attempts per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: mongoRateLimitStore('auth', 15 * 60 * 1000),
  message: {
    status: 'error',
    message: 'Too many attempts from this IP. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: true,   // Only count failed attempts toward the limit
})

/**
 * General API limiter — prevents DDoS and API abuse.
 * 120 requests per minute per IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: mongoRateLimitStore('api', 60 * 1000),
  message: {
    status: 'error',
    message: 'Too many requests from this IP. Please slow down.',
  },
})

/**
 * Strict limiter for upload endpoints — prevents storage abuse.
 * 10 uploads per hour per IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: mongoRateLimitStore('upload', 60 * 60 * 1000),
  message: {
    status: 'error',
    message: 'Upload limit reached. Please try again in an hour.',
  },
})

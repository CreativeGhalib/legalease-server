import { rateLimit } from 'express-rate-limit'

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.' } },
})

function mutationLimit(limit, code, message) { return rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, error: { code, message } } }) }
export const checkoutRateLimit = mutationLimit(12, 'CHECKOUT_RATE_LIMITED', 'Too many payment attempts. Please try again later.')
export const uploadRateLimit = mutationLimit(30, 'UPLOAD_RATE_LIMITED', 'Too many upload attempts. Please try again later.')
export const adminMutationRateLimit = mutationLimit(60, 'ADMIN_MUTATION_RATE_LIMITED', 'Too many administration changes. Please try again later.')

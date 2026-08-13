import { env } from '../config/env.js'

export function verifyOrigin(request, _response, next) {
  const origin = request.get('origin')
  if (!origin || env.clientOrigins.includes(origin)) return next()
  const error = new Error('Request origin is not allowed.')
  error.statusCode = 403
  error.code = 'ORIGIN_DENIED'
  return next(error)
}

import { env } from '../config/env.js'

export function errorHandler(error, _request, response, _next) {
  const statusCode = error.statusCode ?? 500
  const message = statusCode >= 500 && env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : error.message

  response.status(statusCode).json({
    success: false,
    error: { code: error.code ?? 'INTERNAL_ERROR', message },
  })
}

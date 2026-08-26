import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export function errorHandler(error, request, response, _next) {
  const bodyTooLarge = error.type === 'entity.too.large'
  const statusCode = bodyTooLarge ? 413 : error.statusCode ?? 500
  const message = statusCode >= 500 && env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : bodyTooLarge ? 'Request body is too large.' : error.message

  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      error: error.message,
      stack: error.stack,
      code: error.code,
    })
  }

  response.status(statusCode).json({
    success: false,
    error: { code: bodyTooLarge ? 'REQUEST_TOO_LARGE' : error.code ?? 'INTERNAL_ERROR', message },
  })
}

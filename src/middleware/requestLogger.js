import { randomUUID } from 'node:crypto'
import { logger } from '../config/logger.js'

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/

export function requestLogger(request, response, next) {
  const incoming = request.headers['x-request-id']
  const requestId = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID()

  request.requestId = requestId
  response.setHeader('X-Request-ID', requestId)

  logger.info(`${request.method} ${request.originalUrl}`, {
    requestId,
    method: request.method,
    path: request.path,
  })

  return next()
}

/**
 * NoSQL injection prevention middleware — Express 5 compatible.
 *
 * express-mongo-sanitize and xss-clean both mutate req.query, which is
 * a read-only getter in Express 5 and causes a 500 crash.
 *
 * This middleware sanitizes only req.body (writable), stripping MongoDB
 * operator keys ($ and .) that could be used for injection attacks.
 *
 * Query-string injection is handled by Zod validators in every route —
 * they validate and type-coerce all query params before controller access,
 * so operator-shaped values never reach database queries.
 */

/**
 * Recursively strip keys that start with $ or contain . from an object.
 * Returns a new sanitized object — does not mutate the original.
 */
function stripOperators(value) {
  if (Array.isArray(value)) {
    return value.map(stripOperators)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('$') && !key.includes('.'))
        .map(([key, val]) => [key, stripOperators(val)])
    )
  }
  return value
}

/**
 * Express middleware that sanitizes req.body against NoSQL operator injection.
 */
export function sanitizeBody(request, _response, next) {
  if (request.body && typeof request.body === 'object') {
    request.body = stripOperators(request.body)
  }
  next()
}

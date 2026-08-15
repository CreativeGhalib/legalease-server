function normalizeRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function authorizeRoles(...roles) {
  const allowedRoles = new Set(roles.map((role) => normalizeRole(role)))

  return (request, _response, next) => {
    const requestRole = normalizeRole(request.auth?.user?.role)
    if (allowedRoles.has(requestRole)) return next()
    const error = new Error('You do not have permission to perform this action.')
    error.statusCode = 403
    error.code = 'AUTHORIZATION_DENIED'
    return next(error)
  }
}

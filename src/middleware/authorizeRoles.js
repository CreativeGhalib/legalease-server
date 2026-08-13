export function authorizeRoles(...roles) {
  return (request, _response, next) => {
    if (roles.includes(request.auth?.user.role)) return next()
    const error = new Error('You do not have permission to perform this action.')
    error.statusCode = 403
    error.code = 'AUTHORIZATION_DENIED'
    return next(error)
  }
}

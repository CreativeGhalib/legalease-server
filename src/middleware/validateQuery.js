export function validateQuery(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.query)
    if (result.success) {
      request.validatedQuery = result.data
      return next()
    }
    const error = new Error(result.error.issues[0]?.message ?? 'Invalid query parameters.')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    return next(error)
  }
}

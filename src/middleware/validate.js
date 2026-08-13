export function validate(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body)
    if (result.success) {
      request.body = result.data
      return next()
    }
    const error = new Error(result.error.issues[0]?.message ?? 'Invalid request data.')
    error.statusCode = 400
    error.code = 'VALIDATION_ERROR'
    return next(error)
  }
}

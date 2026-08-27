import mongoose from 'mongoose'

/**
 * Express middleware that validates a route parameter as a MongoDB ObjectId.
 * Responds with 400 before any controller/DB work if the ID is malformed.
 *
 * Usage:
 *   router.get('/:id', validateObjectId('id'), controller)
 *   router.get('/:lawyerId', validateObjectId('lawyerId'), controller)
 */
export function validateObjectId(param = 'id') {
  return (request, _response, next) => {
    const value = request.params[param]
    if (!mongoose.isObjectIdOrHexString(value)) {
      const error = new Error(`Invalid ${param}: not a valid resource identifier.`)
      error.statusCode = 400
      error.code = 'INVALID_OBJECT_ID'
      return next(error)
    }
    return next()
  }
}

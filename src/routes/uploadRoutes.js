import multer from 'multer'
import { Router } from 'express'
import { uploadProfileImage } from '../controllers/uploadController.js'
import { authenticate } from '../middleware/authenticate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { uploadRateLimit } from '../middleware/rateLimits.js'

export const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 }, fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) })
const uploadRouter = Router()

function handleImageUpload(request, response, next) {
  imageUpload.single('image')(request, response, (error) => {
    if (error) {
      error.statusCode = error.code === 'LIMIT_FILE_SIZE' ? 400 : 400
      error.code = error.code === 'LIMIT_FILE_SIZE' ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE_UPLOAD'
      error.message = error.code === 'IMAGE_TOO_LARGE' ? 'Image files must be 3 MB or smaller.' : 'Upload one JPG, PNG, or WebP image.'
      return next(error)
    }
    if (request.file && !['image/jpeg', 'image/png', 'image/webp'].includes(request.file.mimetype)) {
      const invalidType = Object.assign(new Error('Upload one JPG, PNG, or WebP image.'), { statusCode: 400, code: 'INVALID_IMAGE_TYPE' })
      return next(invalidType)
    }
    return next()
  })
}

uploadRouter.post('/image', uploadRateLimit, authenticate, verifyOrigin, handleImageUpload, uploadProfileImage)
export default uploadRouter

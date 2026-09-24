import multer from 'multer'
import { Router } from 'express'
import { uploadProfileImage } from '../controllers/uploadController.js'
import { authenticate } from '../middleware/authenticate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { uploadRateLimit } from '../middleware/rateLimits.js'

export const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 }, fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) })
const uploadRouter = Router()

const IMAGE_SIGNATURES = {
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
}

export function validateImageContents(request, _response, next) {
  if (!request.file) return next()
  if (IMAGE_SIGNATURES[request.file.mimetype]?.(request.file.buffer)) return next()
  return next(Object.assign(new Error('The uploaded file content does not match a supported image format.'), {
    statusCode: 400,
    code: 'INVALID_IMAGE_CONTENT',
  }))
}

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
    return validateImageContents(request, response, next)
  })
}

uploadRouter.post('/image', uploadRateLimit, authenticate, verifyOrigin, handleImageUpload, uploadProfileImage)
export default uploadRouter

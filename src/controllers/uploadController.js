import { env } from '../config/env.js'

export async function uploadProfileImage(request, response, next) {
  try {
    if (!env.IMGBB_API_KEY) {
      const error = new Error('Image upload is not configured yet.')
      error.statusCode = 503
      error.code = 'IMAGE_UPLOAD_UNAVAILABLE'
      throw error
    }
    if (!request.file) {
      const error = new Error('Choose an image file to upload.')
      error.statusCode = 400
      error.code = 'IMAGE_REQUIRED'
      throw error
    }
    const body = new FormData()
    body.append('image', new Blob([request.file.buffer], { type: request.file.mimetype }), request.file.originalname)
    const upload = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, { method: 'POST', body, signal: AbortSignal.timeout(20_000) })
    const result = await upload.json().catch(() => null)
    if (!upload.ok || !result?.success || !result.data?.url) {
      const error = new Error('Image hosting could not complete the upload. Please try again.')
      error.statusCode = 502
      error.code = 'IMAGE_UPLOAD_FAILED'
      throw error
    }
    return response.status(201).json({ success: true, data: { url: result.data.display_url ?? result.data.url } })
  } catch (error) { return next(error) }
}

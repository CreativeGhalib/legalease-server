import { env } from '../config/env.js'

/**
 * Shared imgBB transfer for any authenticated image upload. Throws typed
 * errors (503/400/502) — callers decide how to surface failures.
 */
export async function transferFileToImgbb(file) {
  if (!env.IMGBB_API_KEY) {
    throw Object.assign(new Error('Image upload is not configured yet.'), {
      statusCode: 503,
      code: 'IMAGE_UPLOAD_UNAVAILABLE',
    })
  }
  if (!file) {
    throw Object.assign(new Error('Choose an image file to upload.'), {
      statusCode: 400,
      code: 'IMAGE_REQUIRED',
    })
  }

  const body = new FormData()
  body.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname)
  const upload = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`,
    { method: 'POST', body, signal: AbortSignal.timeout(20_000) },
  )
  const result = await upload.json().catch(() => null)
  if (!upload.ok || !result?.success || !result.data?.url) {
    throw Object.assign(new Error('Image hosting could not complete the upload. Please try again.'), {
      statusCode: 502,
      code: 'IMAGE_UPLOAD_FAILED',
    })
  }
  return result.data.display_url ?? result.data.url
}

export async function uploadProfileImage(request, response, next) {
  try {
    const url = await transferFileToImgbb(request.file)
    return response.status(201).json({ success: true, data: { url } })
  } catch (error) {
    return next(error)
  }
}

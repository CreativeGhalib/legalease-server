import { toSafeUser } from '../utils/auth.js'

export function getMyAccount(request, response) {
  return response.json({ success: true, data: { user: toSafeUser(request.auth.user) } })
}

export async function updateMyAccount(request, response, next) {
  try {
    Object.assign(request.auth.user, request.body)
    await request.auth.user.save()
    return response.json({ success: true, data: { user: toSafeUser(request.auth.user) } })
  } catch (error) { return next(error) }
}

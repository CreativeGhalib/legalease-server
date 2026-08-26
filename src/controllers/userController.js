import { toSafeUser } from '../utils/auth.js'
import { enforceDeletionWindow } from './accountController.js'

export async function getMyAccount(request, response, next) {
  try {
    if (await enforceDeletionWindow(request, response)) return undefined
    return response.json({ success: true, data: { user: toSafeUser(request.auth.user) } })
  } catch (error) {
    return next(error)
  }
}

export async function updateMyAccount(request, response, next) {
  try {
    if (await enforceDeletionWindow(request, response)) return undefined
    Object.assign(request.auth.user, request.body)
    await request.auth.user.save()
    return response.json({ success: true, data: { user: toSafeUser(request.auth.user) } })
  } catch (error) { return next(error) }
}

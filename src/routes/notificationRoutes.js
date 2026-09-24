import { Router } from 'express'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notificationController.js'
import { authenticate } from '../middleware/authenticate.js'
import { validateObjectId } from '../middleware/validateObjectId.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { notificationQuerySchema } from '../validators/notificationValidators.js'

const notificationRouter = Router()

notificationRouter.use(authenticate)

notificationRouter.get('/', validateQuery(notificationQuerySchema), listNotifications)
notificationRouter.patch('/read-all', verifyOrigin, markAllNotificationsRead)
notificationRouter.patch('/:id/read', verifyOrigin, validateObjectId('id'), markNotificationRead)

export default notificationRouter

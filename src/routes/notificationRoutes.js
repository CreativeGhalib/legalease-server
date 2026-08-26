import { Router } from 'express'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notificationController.js'
import { authenticate } from '../middleware/authenticate.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { notificationQuerySchema } from '../validators/notificationValidators.js'

const notificationRouter = Router()

notificationRouter.use(authenticate)

notificationRouter.get('/', validateQuery(notificationQuerySchema), listNotifications)
notificationRouter.patch('/read-all', markAllNotificationsRead)
notificationRouter.patch('/:id/read', markNotificationRead)

export default notificationRouter

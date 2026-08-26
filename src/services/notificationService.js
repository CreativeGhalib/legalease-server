import { Notification } from '../models/Notification.js'
import { logger } from '../config/logger.js'

export const MAX_NOTIFICATIONS_PER_USER = 50

export async function createNotification({ userId, title, message, type, link = null }) {
  try {
    await Notification.create({ userId, title, message, type, link })

    const total = await Notification.countDocuments({ userId })
    if (total > MAX_NOTIFICATIONS_PER_USER) {
      const overflow = await Notification.find({ userId })
        .sort({ createdAt: 1, _id: 1 })
        .skip(MAX_NOTIFICATIONS_PER_USER)
        .select('_id')
        .lean()
      if (overflow.length) {
        await Notification.deleteMany({ _id: { $in: overflow.map((doc) => doc._id) } })
      }
    }
  } catch (error) {
    logger.warn('Notification creation failed.', { error: error.message, userId: String(userId) })
  }
}

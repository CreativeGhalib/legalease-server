import mongoose from 'mongoose'
import { Notification } from '../models/Notification.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function safeNotification(notification) {
  return {
    id: notification._id.toString(),
    title: notification.title,
    message: notification.message,
    type: notification.type,
    link: notification.link,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  }
}

export async function listNotifications(request, response, next) {
  try {
    const query = request.validatedQuery
    const filter = { userId: request.auth.user.id }
    if (query.unread) filter.isRead = false

    const [items, totalItems, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),  // M-10: read-only list — lean skips Mongoose hydration
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: request.auth.user.id, isRead: false }),
    ])

    return response.json({
      success: true,
      data: {
        items: items.map(safeNotification),
        unreadCount,
      },
      meta: {
        page: query.page,
        pageSize: query.limit,
        totalItems,
        totalPages: Math.ceil(totalItems / query.limit),
      },
    })
  } catch (error) {
    return next(error)
  }
}

export async function markNotificationRead(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) {
      throw fail('Notification was not found.', 404, 'NOTIFICATION_NOT_FOUND')
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: request.params.id, userId: request.auth.user.id },
      { $set: { isRead: true } },
      { new: true },
    )
    if (!updated) throw fail('Notification was not found.', 404, 'NOTIFICATION_NOT_FOUND')
    return response.json({ success: true, data: { notification: safeNotification(updated) } })
  } catch (error) {
    return next(error)
  }
}

export async function markAllNotificationsRead(request, response, next) {
  try {
    const result = await Notification.updateMany(
      { userId: request.auth.user.id, isRead: false },
      { $set: { isRead: true } },
    )
    return response.json({ success: true, data: { updated: result.modifiedCount } })
  } catch (error) {
    return next(error)
  }
}

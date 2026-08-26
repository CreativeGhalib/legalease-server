import { z } from 'zod'

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  unread: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
}).strict()

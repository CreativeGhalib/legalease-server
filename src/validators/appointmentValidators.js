import { z } from 'zod'

export const slotsQuerySchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use the YYYY-MM-DD format.'),
}).strict()

export const createAppointmentSchema = z.object({
  lawyerProfileId: z.string().trim().min(1),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use the YYYY-MM-DD format.'),
  start: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, 'Choose a valid slot time.'),
}).strict()

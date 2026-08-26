import { z } from 'zod'

export const createReviewSchema = z.object({
  hiringRequestId: z.string().trim().min(1, 'A hiring request is required.'),
  rating: z.coerce.number({ message: 'Rating must be a number.' }).int('Rating must be a whole number.').min(1, 'Rating must be between 1 and 5.').max(5, 'Rating must be between 1 and 5.'),
  feedback: z.string().trim().max(1000, 'Feedback cannot exceed 1000 characters.').optional(),
}).strict()

export const publicReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(5),
}).strict()

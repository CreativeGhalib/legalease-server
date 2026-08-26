import { z } from 'zod'

export const openDisputeSchema = z.object({
  hiringRequestId: z.string().trim().min(1, 'A hiring request is required.'),
  reason: z.string().trim()
    .min(10, 'Describe the issue in at least 10 characters.')
    .max(1000, 'Reason cannot exceed 1000 characters.'),
}).strict()

export const resolveDisputeSchema = z.object({
  outcome: z.enum(['refund', 'release']),
  note: z.string().trim().min(5, 'A resolution note of at least 5 characters is required.').max(600),
}).strict()

export const releaseOverrideSchema = z.object({
  note: z.string().trim().min(5, 'A note of at least 5 characters is required.').max(600),
}).strict()

export const disputesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(['open', 'resolved_refund', 'resolved_release']).optional(),
}).strict()

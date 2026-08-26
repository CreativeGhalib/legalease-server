import { z } from 'zod'
export const roleSchema = z.object({ role: z.enum(['user', 'lawyer', 'admin']) }).strict()
export const statusSchema = z.object({ status: z.enum(['active', 'deactivated']) }).strict()
export const publicationActionSchema = z.object({ action: z.enum(['publish', 'unpublish', 'suspend', 'restore']) }).strict()
export const tierSchema = z.object({ tier: z.enum(['bronze', 'silver', 'gold']) }).strict()
export const adminQuerySchema = z.object({ search: z.string().trim().max(100).optional(), role: z.enum(['user', 'lawyer', 'admin']).optional(), status: z.enum(['active', 'deactivated']).optional(), page: z.coerce.number().int().min(1).default(1) }).strict()
export const adminLawyerQuerySchema = z.object({ publicationStatus: z.enum(['draft', 'published', 'unpublished', 'suspended', 'deleted']).optional(), verificationStatus: z.enum(['unpaid', 'checkout_created', 'paid']).optional(), page: z.coerce.number().int().min(1).default(1) }).strict()
export const adminTransactionQuerySchema = z.object({ type: z.enum(['lawyer_verification', 'hiring_fee']).optional(), status: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(), page: z.coerce.number().int().min(1).default(1) }).strict()

export const resolveDisputeSchema = z.object({ outcome: z.enum(['refund', 'release']), note: z.string().trim().min(5, 'A resolution note of at least 5 characters is required.').max(600) }).strict()
export const releaseOverrideSchema = z.object({ note: z.string().trim().min(5, 'A note of at least 5 characters is required.').max(600) }).strict()
export const disputesQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.enum(['open', 'resolved_refund', 'resolved_release']).optional() }).strict()

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  action: z.string().trim().max(60).optional(),
  actorId: z.string().trim().optional(),
}).strict()

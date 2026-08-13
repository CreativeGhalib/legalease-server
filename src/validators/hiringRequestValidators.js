import { z } from 'zod'

export const createHiringRequestSchema = z.object({ lawyerProfileId: z.string().trim().min(1) }).strict()
export const hiringDecisionSchema = z.object({ decision: z.enum(['accepted', 'rejected']) }).strict()

import { z } from 'zod'

export const googleCredentialSchema = z.object({
  credential: z.string().trim().min(1).max(10_000),
  role: z.enum(['user', 'lawyer']).optional(),
})

export const googleOnboardingSchema = z.object({
  role: z.enum(['user', 'lawyer']),
})

import { z } from 'zod'

const normalizedEmail = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(12, 'Password must contain at least 12 characters.').max(128)

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: normalizedEmail,
  password,
  confirmPassword: z.string(),
  role: z.enum(['user', 'lawyer']),
}).refine((data) => data.password === data.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] })

export const loginSchema = z.object({ email: normalizedEmail, password: z.string().min(1).max(128) })

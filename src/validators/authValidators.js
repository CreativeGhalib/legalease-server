import { z } from 'zod'

export const sendPhoneOtpSchema = z.object({
  phone: z.string().trim().regex(/^(?:\+?880|0)1[3-9]\d{8}$/, 'Enter a valid Bangladesh mobile number.'),
}).strict()

export const verifyPhoneOtpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
}).strict()

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

export const forgotPasswordSchema = z.object({ email: normalizedEmail }).strict()

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'A password reset token is required.').max(128),
  password,
}).strict()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(128),
  newPassword: password,
}).strict()

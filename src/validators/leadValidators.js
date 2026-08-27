import { z } from 'zod'

const phoneSchema = z.string().trim().min(8).max(24).regex(/^\+?[0-9][0-9\s()-]*$/, 'Enter a valid phone number.')

export const createLeadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  legalIssue: z.string().trim().max(1500).optional().default(''),
  urgencyLevel: z.enum(['low', 'normal', 'urgent']).optional().default('normal'),
  source: z.enum(['hero', 'exit_intent', 'callback', 'lawyer_profile', 'chatbot']),
}).strict()

export const leadQuerySchema = z.object({
  status: z.enum(['new', 'contacted', 'converted', 'cold']).optional(),
  source: z.enum(['hero', 'exit_intent', 'callback', 'lawyer_profile', 'chatbot']).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
}).strict()

export const leadStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'converted', 'cold']),
}).strict()

export const leadNoteSchema = z.object({
  note: z.string().trim().min(2).max(1000),
}).strict()

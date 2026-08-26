import { z } from 'zod'

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(2, 'Milestone title must contain at least 2 characters.').max(120),
  description: z.string().trim().max(600, 'Description cannot exceed 600 characters.').optional(),
  dueDate: z.coerce.date({ message: 'Due date must be a valid date.' }).optional(),
  order: z.coerce.number().int().min(0).max(50).optional(),
}).strict()

export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(600).optional(),
  dueDate: z.coerce.date({ message: 'Due date must be a valid date.' }).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')

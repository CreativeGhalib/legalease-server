import { z } from 'zod'

const content = z.string().trim().min(2, 'Comment must contain at least 2 characters.').max(1000, 'Comment cannot exceed 1000 characters.')
export const commentContentSchema = z.object({ content }).strict()

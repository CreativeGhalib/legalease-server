import { z } from 'zod'

export const intakeQualifySchema = z.object({
  message: z.string().trim()
    .min(10, 'Describe your issue in at least 10 characters.')
    .max(1000, 'Please keep the description under 1000 characters.'),
}).strict()

import { z } from 'zod'

const currencyAmount = z.string()
  .trim()
  .regex(/^\d{1,6}(?:\.\d{1,2})?$/, 'Fee values must be non-negative USD amounts with at most two decimals.')
  .transform((value) => Math.round(Number(value) * 100))

const optionalText = z.preprocess(
  (value) => typeof value === 'string' ? value.trim() : value,
  z.string().max(100, 'Search and specialization filters must be 100 characters or fewer.').optional(),
).transform((value) => value || undefined)

const optionalFee = z.preprocess(
  (value) => value === '' ? undefined : value,
  currencyAmount.optional(),
)

export const publicLawyerQuerySchema = z.object({
  search: optionalText,
  specialization: optionalText,
  minFee: optionalFee,
  maxFee: optionalFee,
  availability: z.enum(['available', 'busy']).optional(),
  sort: z.enum(['newest', 'fee-low', 'fee-high', 'most-hired']).default('newest'),
  page: z.preprocess(
    (value) => value === undefined ? undefined : value,
    z.string().regex(/^[1-9]\d*$/, 'Page must be a positive integer.').transform(Number).default(1),
  ),
}).strict().superRefine((value, context) => {
  if (value.minFee !== undefined && value.maxFee !== undefined && value.minFee > value.maxFee) {
    context.addIssue({ code: 'custom', path: ['maxFee'], message: 'Maximum fee must be greater than or equal to minimum fee.' })
  }
})

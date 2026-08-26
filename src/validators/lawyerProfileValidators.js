import { z } from 'zod'

const optionalText = (maximum) => z.string().trim().max(maximum).optional()
const nonEmptyText = (maximum, label) => z.string().trim().min(1, `${label} is required when supplied.`).max(maximum).optional()
const hostedPhotoUrl = z.union([z.literal(''), z.string().trim().url('Professional photo URL must be valid.').refine(
  (value) => /^https:\/\/i\.ibb\.co\//i.test(value),
  'Professional photos must be uploaded through LegalEase image upload.',
)]).optional()

function normalizedList(itemMaximum, label) {
  return z.array(z.string().trim().min(1, `${label} entries cannot be empty.`).max(itemMaximum))
    .max(12, `No more than 12 ${label.toLowerCase()} entries are allowed.`)
    .transform((items) => items.reduce((unique, item) => {
      if (!unique.some((saved) => saved.toLocaleLowerCase() === item.toLocaleLowerCase())) unique.push(item)
      return unique
    }, []))
    .optional()
}

const consultationFee = z.union([
  z.string().trim().regex(/^\d{1,6}(?:\.\d{1,2})?$/, 'Consultation fee must be a positive USD amount with at most two decimals.'),
  z.number().finite().positive().max(999999),
]).transform((value) => Math.round(Number(value) * 100)).refine((value) => value > 0, 'Consultation fee must be greater than zero.').optional()

export const lawyerProfileSchema = z.object({
  professionalPhotoUrl: hostedPhotoUrl,
  specialization: nonEmptyText(100, 'Specialization'),
  additionalSpecializations: normalizedList(100, 'Additional specializations'),
  bio: optionalText(3000),
  consultationFeeMinor: consultationFee,
  experienceYears: z.coerce.number().int().min(0).max(80).optional(),
  licenseNumber: optionalText(120),
  barAssociationBranch: optionalText(120),
  location: optionalText(160),
  languages: normalizedList(60, 'Languages'),
  availability: z.enum(['available', 'busy']).optional(),
}).strict()

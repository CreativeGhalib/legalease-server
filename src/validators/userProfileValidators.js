import { z } from 'zod'

const accountPhotoUrl = z.union([
  z.literal(''),
  z.string().trim().url('Profile photo URL must be valid.').refine(
    (value) => /^https:\/\/i\.ibb\.co\//i.test(value),
    'Profile photos must be uploaded through LegalEase image upload.',
  ),
]).optional()

export const userProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must contain at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.').optional(),
  profileImageUrl: accountPhotoUrl,
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field to update.')

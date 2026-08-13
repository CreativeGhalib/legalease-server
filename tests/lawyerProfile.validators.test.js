import assert from 'node:assert/strict'
import test from 'node:test'
import { lawyerProfileSchema } from '../src/validators/lawyerProfileValidators.js'

test('lawyer profile validation normalizes service data and stores fees as cents', () => {
  const parsed = lawyerProfileSchema.parse({
    professionalPhotoUrl: 'https://i.ibb.co/example/professional-photo.png',
    specialization: '  Family law ',
    additionalSpecializations: ['Mediation', ' mediation ', 'Criminal law'],
    bio: '  Client-focused legal guidance. ',
    consultationFeeMinor: '125.50',
    experienceYears: '0',
    licenseNumber: ' BAR-12 ',
    location: ' Dhaka ',
    languages: ['Bangla', ' bangla ', 'English'],
    availability: 'available',
  })

  assert.equal(parsed.specialization, 'Family law')
  assert.deepEqual(parsed.additionalSpecializations, ['Mediation', 'Criminal law'])
  assert.equal(parsed.consultationFeeMinor, 12550)
  assert.equal(parsed.experienceYears, 0)
  assert.deepEqual(parsed.languages, ['Bangla', 'English'])
})

test('lawyer profile validation permits incomplete drafts but rejects unsafe state changes', () => {
  assert.deepEqual(lawyerProfileSchema.parse({ bio: '' }), { bio: '' })
  assert.throws(() => lawyerProfileSchema.parse({ specialization: '' }))
  assert.throws(() => lawyerProfileSchema.parse({ consultationFeeMinor: '0' }))
  assert.throws(() => lawyerProfileSchema.parse({ professionalPhotoUrl: 'https://example.test/image.png' }))
  assert.throws(() => lawyerProfileSchema.parse({ publicationStatus: 'published' }))
  assert.throws(() => lawyerProfileSchema.parse({ verificationStatus: 'paid' }))
})

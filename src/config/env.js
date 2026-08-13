import 'dotenv/config'
import { z } from 'zod'

const mongoConnectionString = z.string().trim().refine(
  (value) => /^mongodb(?:\+srv)?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(value),
  'MONGODB_URI must be a valid MongoDB connection string.',
)

function optionalEnvironmentValue(schema) {
  return z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined,
    schema.optional(),
  )
}

const optionalSecret = optionalEnvironmentValue(z.string().min(32))
const optionalGoogleClientId = optionalEnvironmentValue(z.string().min(1))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: mongoConnectionString.optional(),
  MONGODB_DB_NAME: z.string().min(1).default('legalease'),
  CLIENT_ORIGINS: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters.'),
  COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('legalease_session'),
  GOOGLE_CLIENT_ID: optionalGoogleClientId,
  GOOGLE_ONBOARDING_SECRET: optionalSecret,
  GOOGLE_ONBOARDING_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('legalease_google_onboarding'),
  ADMIN_NAME: z.string().trim().min(2).optional(),
  ADMIN_EMAIL: z.string().trim().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  throw new Error(`Invalid environment configuration: ${result.error.issues.map((issue) => issue.message).join(', ')}`)
}

const values = result.data
const clientOrigins = values.CLIENT_ORIGINS
  ? values.CLIENT_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : values.NODE_ENV === 'development'
    ? ['http://localhost:5173']
    : []

if (values.NODE_ENV === 'production' && clientOrigins.length === 0) {
  throw new Error('CLIENT_ORIGINS is required in production.')
}

if (values.GOOGLE_CLIENT_ID && !values.GOOGLE_ONBOARDING_SECRET) {
  throw new Error('GOOGLE_ONBOARDING_SECRET is required when GOOGLE_CLIENT_ID is configured.')
}

export const env = { ...values, clientOrigins }

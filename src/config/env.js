import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().url().optional(),
  MONGODB_DB_NAME: z.string().min(1).default('legalease'),
  CLIENT_ORIGINS: z.string().optional(),
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

export const env = { ...values, clientOrigins }

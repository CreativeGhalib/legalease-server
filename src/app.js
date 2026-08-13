import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import healthRouter from './routes/healthRoutes.js'
import authRouter from './routes/authRoutes.js'

const app = express()

app.use(helmet())
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.clientOrigins.includes(origin)) return callback(null, true)
    return callback(Object.assign(new Error('Origin is not allowed by CORS.'), { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }))
  },
}))
app.use(express.json())
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use(notFound)
app.use(errorHandler)

export default app

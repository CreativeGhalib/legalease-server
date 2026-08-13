import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { ensureDatabaseConnection } from './config/database.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import healthRouter from './routes/healthRoutes.js'
import authRouter from './routes/authRoutes.js'
import lawyerRouter from './routes/lawyerRoutes.js'
import uploadRouter from './routes/uploadRoutes.js'
import paymentRouter, { stripeWebhookRouter } from './routes/paymentRoutes.js'
import userRouter from './routes/userRoutes.js'
import hiringRouter from './routes/hiringRequestRoutes.js'
import commentRouter, { lawyerCommentRouter } from './routes/commentRoutes.js'
import adminRouter from './routes/adminRoutes.js'

const app = express()

app.use(helmet({
  contentSecurityPolicy: env.GOOGLE_CLIENT_ID ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com'],
      connectSrc: ["'self'", 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com', 'https://i.ibb.co'],
    },
  } : undefined,
}))
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.clientOrigins.includes(origin)) return callback(null, true)
    return callback(Object.assign(new Error('Origin is not allowed by CORS.'), { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }))
  },
}))
if (process.env.VERCEL) {
  app.use(async (request, response, next) => {
    try {
      await ensureDatabaseConnection()
      next()
    } catch (error) {
      next(error)
    }
  })
}
app.use('/api/payments', stripeWebhookRouter)
app.use(express.json({ limit: '100kb' }))
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', userRouter)
app.use('/api/hiring-requests', hiringRouter)
app.use('/api/comments', commentRouter)
app.use('/api/admin', adminRouter)
app.use('/api/lawyers', lawyerCommentRouter)
app.use('/api/lawyers', lawyerRouter)
app.use('/api/uploads', uploadRouter)
app.use('/api/payments', paymentRouter)
app.use(notFound)
app.use(errorHandler)

export default app

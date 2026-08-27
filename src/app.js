import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import compression from 'compression'
import { sanitizeBody } from './middleware/sanitize.js'
import { env } from './config/env.js'
import { ensureDatabaseConnection } from './config/database.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { requestLogger } from './middleware/requestLogger.js'
import { apiLimiter, authLimiter, uploadLimiter } from './middleware/rateLimits.js'
import healthRouter from './routes/healthRoutes.js'
import authRouter from './routes/authRoutes.js'
import lawyerRouter from './routes/lawyerRoutes.js'
import uploadRouter from './routes/uploadRoutes.js'
import paymentRouter, { sslcommerzIpnRouter, stripeWebhookRouter } from './routes/paymentRoutes.js'
import userRouter from './routes/userRoutes.js'
import hiringRouter from './routes/hiringRequestRoutes.js'
import commentRouter, { lawyerCommentRouter } from './routes/commentRoutes.js'
import adminRouter from './routes/adminRoutes.js'
import reviewRouter from './routes/reviewRoutes.js'
import publicRouter from './routes/publicRoutes.js'
import notificationRouter from './routes/notificationRoutes.js'
import caseRouter from './routes/caseRoutes.js'
import appointmentRouter from './routes/appointmentRoutes.js'
import intakeRouter from './routes/intakeRoutes.js'
import disputeRouter from './routes/disputeRoutes.js'
import seoRouter from './routes/seoRoutes.js'
import leadRouter from './routes/leadRoutes.js'

const app = express()

// ── Request correlation ─────────────────────────────────────────────────────
// Must run before every other middleware so logs, errors, and responses all
// share one request identity for the full lifetime of the request.
app.use(requestLogger)

// ── Proxy trust ────────────────────────────────────────────────────────────────
// Vercel terminates the public request before forwarding it to this Express app.
// Trust exactly that proxy hop so targeted rate limits identify the browser rather
// than the shared Vercel address. Local development continues to use Express defaults.
if (process.env.VERCEL) app.set('trust proxy', 1)

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: env.GOOGLE_CLIENT_ID ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com', 'https://js.stripe.com'],
      frameSrc: ["'self'", 'https://accounts.google.com', 'https://js.stripe.com'],
      connectSrc: ["'self'", 'https://accounts.google.com', ...env.clientOrigins],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com', 'https://i.ibb.co'],
    },
  } : undefined,
  // crossOriginEmbedderPolicy breaks Stripe elements — keep off
  crossOriginEmbedderPolicy: false,
  // Explicit Referrer-Policy — prevents URL leakage across origins for a legal platform (M-15)
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use(cors({
  credentials: true,
  // Cache preflight responses for 24 hours — avoids OPTIONS request on every API call (M-9)
  maxAge: 86400,
  origin(origin, callback) {
    if (!origin || env.clientOrigins.includes(origin)) return callback(null, true)
    return callback(Object.assign(
      new Error('Origin is not allowed by CORS.'),
      { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }
    ))
  },
}))

// ── Vercel serverless DB connection ────────────────────────────────────────────
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

// ── Stripe webhook (raw body BEFORE json parser) ───────────────────────────────
app.use('/api/payments', stripeWebhookRouter)
app.use('/api/v1/payments', stripeWebhookRouter)

// ── SSLCommerz IPN (form-encoded BEFORE json parser) ──────────────────────────
app.use('/api/payments/sslcommerz', sslcommerzIpnRouter)
app.use('/api/v1/payments/sslcommerz', sslcommerzIpnRouter)

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }))

// ── Input sanitization ─────────────────────────────────────────────────────────
// Strip MongoDB $ and . operators from req.body (Express 5 compatible).
// express-mongo-sanitize mutates req.query which is read-only in Express 5.
// Query-string injection is handled by Zod validators in every route.
app.use(sanitizeBody)

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', apiLimiter)
app.use('/api/auth', authLimiter)
app.use('/api/v1/auth', authLimiter)
app.use('/api/uploads', uploadLimiter)
app.use('/api/v1/uploads', uploadLimiter)

// ── Compression ────────────────────────────────────────────────────────────────
// Applied AFTER rate limiting so rejected requests don't consume compression CPU (M-8).
// Gzip/Brotli JSON responses — reduces bandwidth 60-80%.
app.use(compression())

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter)
app.use('/api/v1/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/users', userRouter)
app.use('/api/v1/users', userRouter)
app.use('/api/hiring-requests', hiringRouter)
app.use('/api/v1/hiring-requests', hiringRouter)
app.use('/api/comments', commentRouter)
app.use('/api/v1/comments', commentRouter)
app.use('/api/admin', adminRouter)
app.use('/api/v1/admin', adminRouter)
app.use('/api/lawyers', lawyerCommentRouter)
app.use('/api/lawyers', lawyerRouter)
app.use('/api/v1/lawyers', lawyerCommentRouter)
app.use('/api/v1/lawyers', lawyerRouter)
app.use('/api/uploads', uploadRouter)
app.use('/api/v1/uploads', uploadRouter)
app.use('/api/payments', paymentRouter)
app.use('/api/v1/payments', paymentRouter)
app.use('/api/reviews', reviewRouter)
app.use('/api/v1/reviews', reviewRouter)
app.use('/api', publicRouter)
app.use('/api/v1', publicRouter)
app.use('/api', leadRouter)
app.use('/api/v1', leadRouter)
// ── Search engine endpoints (root-level, public) ─────────────────────────────
app.use('/', seoRouter)

app.use('/api/notifications', notificationRouter)
app.use('/api/v1/notifications', notificationRouter)
app.use('/api/cases', caseRouter)
app.use('/api/v1/cases', caseRouter)
app.use('/api/appointments', appointmentRouter)
app.use('/api/v1/appointments', appointmentRouter)
app.use('/api/intake', intakeRouter)
app.use('/api/v1/intake', intakeRouter)
app.use('/api/disputes', disputeRouter)
app.use('/api/v1/disputes', disputeRouter)

// ── Error handling ─────────────────────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)

export default app

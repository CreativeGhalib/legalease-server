import app from './app.js'
import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'

async function startServer() {
  await connectDatabase()

  const server = app.listen(env.PORT, () => {
    logger.info(`LegalEase API listening on port ${env.PORT}`, {
      env: env.NODE_ENV,
      port: env.PORT,
    })
  })

  // ── Request timeout (M-7) ──────────────────────────────────────────────────
  // 30 s keeps connections from hanging indefinitely during slow external calls.
  // Vercel serverless has its own gateway timeout; this guards self-hosted use.
  server.timeout = 30_000
  server.keepAliveTimeout = 35_000  // must exceed timeout

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Allows in-flight requests to complete before closing DB connections.
  // Without this, abrupt kills can corrupt in-progress writes.
  async function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`)
    server.close(async () => {
      try {
        const mongoose = await import('mongoose')
        await mongoose.default.connection.close()
        logger.info('MongoDB connection closed cleanly')
        process.exit(0)
      } catch (error) {
        logger.error('Error during graceful shutdown', { error: error.message })
        process.exit(1)
      }
    })
    // Force kill if graceful shutdown takes more than 10 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit')
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // ── Unhandled rejection guard ──────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise rejection', { reason: String(reason) })
  })

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack })
    process.exit(1)
  })

  return server
}

startServer().catch((error) => {
  // logger may not be initialized if this fires before config loads — use console as fallback
  console.error('Unable to start LegalEase API.', error)
  process.exit(1)
})

import mongoose from 'mongoose'
import { databaseStatus } from '../config/database.js'

export async function getHealth(_request, response) {
  const startedAt = Date.now()
  let databaseConnected = false

  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping()
      databaseConnected = true
    }
  } catch {
    databaseConnected = false
  }

  response.status(databaseConnected ? 200 : 503).json({
    success: true,
    data: {
      status: databaseConnected ? 'healthy' : 'degraded',
      database: {
        connected: databaseConnected,
        state: databaseStatus(),
        latencyMs: Date.now() - startedAt,
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    },
  })
}

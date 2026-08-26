import mongoose from 'mongoose'
import { env } from './env.js'

export const connectionPoolOptions = {
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  heartbeatFrequencyMS: 10000,
  socketTimeoutMS: 45000,
}

let connectionPromise

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    console.warn('MONGODB_URI is not configured; database connectivity is not active.')
    return false
  }

  await mongoose.connect(env.MONGODB_URI, {
    ...connectionPoolOptions,
    dbName: env.MONGODB_DB_NAME,
  })
  console.info('MongoDB connected.')
  return true
}

export async function ensureDatabaseConnection() {
  if (!env.MONGODB_URI || mongoose.connection.readyState === 1) return Boolean(env.MONGODB_URI)

  if (!connectionPromise) {
    connectionPromise = connectDatabase().catch((error) => {
      connectionPromise = undefined
      throw error
    })
  }

  return connectionPromise
}

export function databaseStatus() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown'
}

import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    console.warn('MONGODB_URI is not configured; database connectivity is not active.')
    return false
  }

  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME })
  console.info('MongoDB connected.')
  return true
}

export function databaseStatus() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown'
}

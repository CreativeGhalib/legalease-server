import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export const RATE_LIMIT_COLLECTION = 'rateLimits'

export class RateLimitMongoStore {
  #indexReady

  constructor({ windowMs = 15 * 60 * 1000, prefix = 'rl' } = {}) {
    this.windowMs = windowMs
    this.prefix = prefix
    this.localKeys = false
    this.#indexReady = null
  }

  collection() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null
    return mongoose.connection.collection(RATE_LIMIT_COLLECTION)
  }

  async init() {
    if (!this.#indexReady) {
      this.#indexReady = Promise.resolve().then(async () => {
        const collection = this.collection()
        if (!collection) return
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      }).catch((error) => {
        logger.error('Rate limit store index creation failed.', { error: error.message })
        this.#indexReady = null
      })
    }
    return this.#indexReady
  }

  #key(key) {
    return { prefix: this.prefix, key }
  }

  async increment(key) {
    try {
      await this.init()
      const collection = this.collection()
      if (!collection) return { totalHits: 1 }

      const now = new Date()
      const live = await collection.findOneAndUpdate(
        { ...this.#key(key), expiresAt: { $gt: now } },
        { $inc: { totalHits: 1 } },
        { returnDocument: 'after' },
      )
      if (live) return { totalHits: live.totalHits, resetTime: live.expiresAt }

      const expiresAt = new Date(now.getTime() + this.windowMs)
      try {
        await collection.updateOne(
          { ...this.#key(key) },
          { $set: { totalHits: 1, expiresAt } },
          { upsert: true },
        )
        return { totalHits: 1, resetTime: expiresAt }
      } catch (error) {
        if (error?.code !== 11000) throw error
        const raced = await collection.findOneAndUpdate(
          { ...this.#key(key), expiresAt: { $gt: now } },
          { $inc: { totalHits: 1 } },
          { returnDocument: 'after' },
        )
        return raced
          ? { totalHits: raced.totalHits, resetTime: raced.expiresAt }
          : { totalHits: 1, resetTime: expiresAt }
      }
    } catch (error) {
      logger.error('Rate limit store increment failed; allowing request.', { error: error.message, prefix: this.prefix })
      return { totalHits: 1 }
    }
  }

  async decrement(key) {
    try {
      const collection = this.collection()
      if (!collection) return
      await collection.updateOne(
        { ...this.#key(key), expiresAt: { $gt: new Date() }, totalHits: { $gt: 0 } },
        { $inc: { totalHits: -1 } },
      )
    } catch (error) {
      logger.error('Rate limit store decrement failed.', { error: error.message, prefix: this.prefix })
    }
  }

  async resetKey(key) {
    try {
      const collection = this.collection()
      if (!collection) return
      await collection.deleteOne(this.#key(key))
    } catch (error) {
      logger.error('Rate limit store reset failed.', { error: error.message, prefix: this.prefix })
    }
  }
}

export function mongoRateLimitStore(prefix, windowMs) {
  if (!env.MONGODB_URI) return undefined
  return new RateLimitMongoStore({ windowMs, prefix })
}

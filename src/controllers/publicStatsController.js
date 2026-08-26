import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { HiringRequest } from '../models/HiringRequest.js'
import { publicLawyerPipeline, publicLawyerProjection } from './publicLawyerController.js'
import { LawyerProfile } from '../models/LawyerProfile.js'

const CACHE_TTL_MS = 5 * 60 * 1000

let cachedStats = { fetchedAt: 0, payload: null }

export function resetStatsCache() {
  cachedStats = { fetchedAt: 0, payload: null }
}

function emptyStats() {
  return { lawyerCount: 0, paidHireCount: 0, userCount: 0, recentLawyers: [] }
}

async function buildStats() {
  if (!env.MONGODB_URI) return emptyStats()

  const pipeline = publicLawyerPipeline({})
  const [lawyerCountRows, paidHireCount, userCount, recentLawyers] = await Promise.all([
    LawyerProfile.aggregate([...pipeline, { $count: 'total' }]),
    HiringRequest.countDocuments({ status: 'accepted', paymentStatus: 'paid' }),
    User.countDocuments({ role: 'user', status: 'active' }),
    LawyerProfile.aggregate([...pipeline, { $sort: pipeline.sort }, { $limit: 3 }, { $project: publicLawyerProjection }]),
  ])

  return {
    lawyerCount: lawyerCountRows[0]?.total ?? 0,
    paidHireCount,
    userCount,
    recentLawyers,
  }
}

export async function getPublicStats(_request, response, next) {
  try {
    const now = Date.now()
    if (!cachedStats.payload || now - cachedStats.fetchedAt > CACHE_TTL_MS) {
      const payload = await buildStats()
      cachedStats = { fetchedAt: now, payload }
    }
    return response.json({ success: true, data: cachedStats.payload })
  } catch (error) {
    return next(error)
  }
}

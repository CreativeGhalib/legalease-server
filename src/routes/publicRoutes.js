import { Router } from 'express'
import { getPublicStats } from '../controllers/publicStatsController.js'

const publicRouter = Router()

publicRouter.get('/stats/public', getPublicStats)

export default publicRouter

import { Router } from 'express'
import { qualifyIntake } from '../controllers/intakeController.js'
import { validate } from '../middleware/validate.js'
import { intakeRateLimit } from '../middleware/rateLimits.js'
import { intakeQualifySchema } from '../validators/intakeValidators.js'

const intakeRouter = Router()

intakeRouter.post('/qualify', intakeRateLimit, validate(intakeQualifySchema), qualifyIntake)

export default intakeRouter

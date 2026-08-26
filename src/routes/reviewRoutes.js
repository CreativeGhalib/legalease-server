import { Router } from 'express'
import { createReview } from '../controllers/reviewController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { createReviewSchema } from '../validators/reviewValidators.js'

const reviewRouter = Router()

reviewRouter.post('/', authenticate, authorizeRoles('user'), verifyOrigin, validate(createReviewSchema), createReview)

export default reviewRouter

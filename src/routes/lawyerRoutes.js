import { Router } from 'express'
import { createMyLawyerProfile, deleteMyLawyerProfile, getMyLawyerProfile, updateMyLawyerProfile } from '../controllers/lawyerProfileController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { lawyerProfileSchema } from '../validators/lawyerProfileValidators.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { publicLawyerQuerySchema } from '../validators/publicLawyerValidators.js'
import { getPublicLawyer, listFeaturedLawyers, listPublicLawyers, listTopLawyers } from '../controllers/publicLawyerController.js'

const lawyerRouter = Router()

lawyerRouter.get('/', validateQuery(publicLawyerQuerySchema), listPublicLawyers)
lawyerRouter.get('/featured', listFeaturedLawyers)
lawyerRouter.get('/top', listTopLawyers)
lawyerRouter.get('/:id', getPublicLawyer)

lawyerRouter.use(authenticate, authorizeRoles('lawyer'))
lawyerRouter.get('/me/profile', getMyLawyerProfile)
lawyerRouter.post('/me/profile', verifyOrigin, validate(lawyerProfileSchema), createMyLawyerProfile)
lawyerRouter.patch('/me/profile', verifyOrigin, validate(lawyerProfileSchema), updateMyLawyerProfile)
lawyerRouter.delete('/me/profile', verifyOrigin, deleteMyLawyerProfile)

export default lawyerRouter

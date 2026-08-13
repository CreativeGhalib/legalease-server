import { Router } from 'express'
import { createMyLawyerProfile, deleteMyLawyerProfile, getMyLawyerProfile, updateMyLawyerProfile } from '../controllers/lawyerProfileController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { lawyerProfileSchema } from '../validators/lawyerProfileValidators.js'

const lawyerRouter = Router()
lawyerRouter.use(authenticate, authorizeRoles('lawyer'))
lawyerRouter.get('/me/profile', getMyLawyerProfile)
lawyerRouter.post('/me/profile', verifyOrigin, validate(lawyerProfileSchema), createMyLawyerProfile)
lawyerRouter.patch('/me/profile', verifyOrigin, validate(lawyerProfileSchema), updateMyLawyerProfile)
lawyerRouter.delete('/me/profile', verifyOrigin, deleteMyLawyerProfile)

export default lawyerRouter

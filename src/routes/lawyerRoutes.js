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
import { getLawyerSlots } from '../controllers/appointmentController.js'
import { updatePublication } from '../controllers/paymentController.js'
import { slotsQuerySchema } from '../validators/appointmentValidators.js'
import { z } from 'zod'

const lawyerRouter = Router()

lawyerRouter.get('/', validateQuery(publicLawyerQuerySchema), listPublicLawyers)
lawyerRouter.get('/featured', listFeaturedLawyers)
lawyerRouter.get('/top', listTopLawyers)
lawyerRouter.get('/:id/slots', validateQuery(slotsQuerySchema), getLawyerSlots)
lawyerRouter.get('/:id', getPublicLawyer)

lawyerRouter.use(authenticate, authorizeRoles('lawyer'))
lawyerRouter.get('/me/profile', getMyLawyerProfile)
lawyerRouter.post('/me/profile', verifyOrigin, validate(lawyerProfileSchema), createMyLawyerProfile)
lawyerRouter.patch('/me/profile', verifyOrigin, validate(lawyerProfileSchema), updateMyLawyerProfile)
lawyerRouter.delete('/me/profile', verifyOrigin, deleteMyLawyerProfile)
lawyerRouter.patch('/me/publication', verifyOrigin, validate(z.object({ publicationStatus: z.enum(['published', 'unpublished']) }).strict()), updatePublication)

export default lawyerRouter

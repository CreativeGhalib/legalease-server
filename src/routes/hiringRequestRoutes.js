import { Router } from 'express'
import { createRequest, decideRequest, getRequest, listMine, listReceived } from '../controllers/hiringRequestController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { validateObjectId } from '../middleware/validateObjectId.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { createHiringRequestSchema, hiringDecisionSchema } from '../validators/hiringRequestValidators.js'

const hiringRouter = Router()
hiringRouter.post('/', authenticate, authorizeRoles('user'), verifyOrigin, validate(createHiringRequestSchema), createRequest)
hiringRouter.get('/mine', authenticate, authorizeRoles('user'), listMine)
hiringRouter.get('/received', authenticate, authorizeRoles('lawyer'), listReceived)
hiringRouter.get('/:id', authenticate, validateObjectId('id'), getRequest)
hiringRouter.patch('/:id/decision', authenticate, validateObjectId('id'), authorizeRoles('lawyer'), verifyOrigin, validate(hiringDecisionSchema), decideRequest)
export default hiringRouter

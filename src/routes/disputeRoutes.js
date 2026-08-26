import { Router } from 'express'
import { openCaseDispute, listMyDisputes } from '../controllers/disputeController.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { openDisputeSchema } from '../validators/disputeValidators.js'

const disputeRouter = Router()

disputeRouter.use(authenticate)

disputeRouter.post('/', verifyOrigin, validate(openDisputeSchema), openCaseDispute)
disputeRouter.get('/mine', listMyDisputes)

export default disputeRouter

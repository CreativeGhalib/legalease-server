import { Router } from 'express'
import { getMyAccount, updateMyAccount } from '../controllers/userController.js'
import { requestAccountDeletion, cancelAccountDeletion, revokeAllSessions } from '../controllers/accountController.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { userProfileUpdateSchema, deleteRequestSchema, revokeSessionsSchema } from '../validators/userProfileValidators.js'

const userRouter = Router()

userRouter.get('/me', authenticate, getMyAccount)
userRouter.patch('/me', authenticate, verifyOrigin, validate(userProfileUpdateSchema), updateMyAccount)
userRouter.post('/me/delete-request', authenticate, verifyOrigin, validate(deleteRequestSchema), requestAccountDeletion)
userRouter.delete('/me/delete-request', authenticate, cancelAccountDeletion)
userRouter.patch('/me/revoke-sessions', authenticate, verifyOrigin, validate(revokeSessionsSchema), revokeAllSessions)

export default userRouter

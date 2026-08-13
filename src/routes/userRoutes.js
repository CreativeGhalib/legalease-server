import { Router } from 'express'
import { getMyAccount, updateMyAccount } from '../controllers/userController.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { userProfileUpdateSchema } from '../validators/userProfileValidators.js'

const userRouter = Router()

userRouter.get('/me', authenticate, getMyAccount)
userRouter.patch('/me', authenticate, verifyOrigin, validate(userProfileUpdateSchema), updateMyAccount)

export default userRouter

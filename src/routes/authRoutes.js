import { Router } from 'express'
import { getCurrentUser, login, logout, register } from '../controllers/authController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authRateLimit } from '../middleware/rateLimits.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { loginSchema, registerSchema } from '../validators/authValidators.js'

const authRouter = Router()

authRouter.post('/register', authRateLimit, verifyOrigin, validate(registerSchema), register)
authRouter.post('/login', authRateLimit, verifyOrigin, validate(loginSchema), login)
authRouter.get('/me', authenticate, getCurrentUser)
authRouter.post('/logout', verifyOrigin, logout)

export default authRouter

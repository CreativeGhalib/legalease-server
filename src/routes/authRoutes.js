import { Router } from 'express'
import { getCurrentUser, login, logout, register } from '../controllers/authController.js'
import { completeGoogleOnboarding, googleAuthenticate } from '../controllers/googleAuthController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authRateLimit } from '../middleware/rateLimits.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { loginSchema, registerSchema } from '../validators/authValidators.js'
import { googleCredentialSchema, googleOnboardingSchema } from '../validators/googleAuthValidators.js'

const authRouter = Router()

authRouter.post('/register', authRateLimit, verifyOrigin, validate(registerSchema), register)
authRouter.post('/login', authRateLimit, verifyOrigin, validate(loginSchema), login)
authRouter.post('/google', authRateLimit, verifyOrigin, validate(googleCredentialSchema), googleAuthenticate)
authRouter.post('/google/onboarding', authRateLimit, verifyOrigin, validate(googleOnboardingSchema), completeGoogleOnboarding)
authRouter.get('/me', authenticate, getCurrentUser)
authRouter.post('/logout', verifyOrigin, logout)

export default authRouter

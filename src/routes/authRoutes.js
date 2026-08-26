import { Router } from 'express'
import { changePassword, forgotPassword, getCurrentUser, login, logout, register, resetPassword } from '../controllers/authController.js'
import { completeGoogleOnboarding, googleAuthenticate } from '../controllers/googleAuthController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authRateLimit } from '../middleware/rateLimits.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { changePasswordSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '../validators/authValidators.js'
import { googleCredentialSchema, googleOnboardingSchema } from '../validators/googleAuthValidators.js'

const authRouter = Router()

authRouter.post('/register', authRateLimit, verifyOrigin, validate(registerSchema), register)
authRouter.post('/login', authRateLimit, verifyOrigin, validate(loginSchema), login)
authRouter.post('/google', authRateLimit, verifyOrigin, validate(googleCredentialSchema), googleAuthenticate)
authRouter.post('/google/onboarding', authRateLimit, verifyOrigin, validate(googleOnboardingSchema), completeGoogleOnboarding)
authRouter.post('/forgot-password', authRateLimit, verifyOrigin, validate(forgotPasswordSchema), forgotPassword)
authRouter.post('/reset-password', authRateLimit, verifyOrigin, validate(resetPasswordSchema), resetPassword)
authRouter.patch('/change-password', authenticate, verifyOrigin, validate(changePasswordSchema), changePassword)
authRouter.get('/me', authenticate, getCurrentUser)
authRouter.post('/logout', verifyOrigin, logout)

export default authRouter

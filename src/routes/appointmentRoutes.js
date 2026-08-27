import { Router } from 'express'
import {
  cancelAppointment,
  completeAppointment,
  createAppointment,
  listLawyerAppointments,
  listMyAppointments,
  startAppointmentCheckoutSslcommerz,
  startAppointmentCheckoutStripe,
} from '../controllers/appointmentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { checkoutRateLimit } from '../middleware/rateLimits.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { validate } from '../middleware/validate.js'
import { validateObjectId } from '../middleware/validateObjectId.js'
import { createAppointmentSchema } from '../validators/appointmentValidators.js'

const appointmentRouter = Router()

appointmentRouter.use(authenticate)

appointmentRouter.post('/', authorizeRoles('user'), verifyOrigin, validate(createAppointmentSchema), createAppointment)
appointmentRouter.get('/mine', listMyAppointments)
appointmentRouter.get('/lawyer', authorizeRoles('lawyer'), listLawyerAppointments)
appointmentRouter.patch('/:id/cancel', validateObjectId('id'), cancelAppointment)
appointmentRouter.patch('/:id/complete', validateObjectId('id'), completeAppointment)

// Paid consultation checkout (8-D) — user only, rate-limited
appointmentRouter.post('/:id/checkout/stripe', validateObjectId('id'), authorizeRoles('user'), verifyOrigin, checkoutRateLimit, startAppointmentCheckoutStripe)
appointmentRouter.post('/:id/checkout/sslcommerz', validateObjectId('id'), authorizeRoles('user'), verifyOrigin, checkoutRateLimit, startAppointmentCheckoutSslcommerz)

export default appointmentRouter

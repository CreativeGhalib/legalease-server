import { Router } from 'express'
import {
  cancelAppointment,
  completeAppointment,
  createAppointment,
  listLawyerAppointments,
  listMyAppointments,
} from '../controllers/appointmentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { createAppointmentSchema } from '../validators/appointmentValidators.js'

const appointmentRouter = Router()

appointmentRouter.use(authenticate)

appointmentRouter.post('/', authorizeRoles('user'), verifyOrigin, validate(createAppointmentSchema), createAppointment)
appointmentRouter.get('/mine', listMyAppointments)
appointmentRouter.get('/lawyer', authorizeRoles('lawyer'), listLawyerAppointments)
appointmentRouter.patch('/:id/cancel', cancelAppointment)
appointmentRouter.patch('/:id/complete', completeAppointment)

export default appointmentRouter

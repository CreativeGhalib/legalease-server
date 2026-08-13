import express, { Router } from 'express'
import { getPaymentStatus, listMyPayments, startHiringCheckout, startVerificationCheckout, stripeWebhook } from '../controllers/paymentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'

export const stripeWebhookRouter = Router()
stripeWebhookRouter.post('/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook)
const paymentRouter = Router()
paymentRouter.post('/publishing/checkout', authenticate, authorizeRoles('lawyer'), verifyOrigin, startVerificationCheckout)
paymentRouter.post('/hiring/:requestId/checkout', authenticate, authorizeRoles('user'), verifyOrigin, startHiringCheckout)
paymentRouter.get('/mine', authenticate, listMyPayments)
paymentRouter.get('/:id/status', authenticate, getPaymentStatus)
export default paymentRouter

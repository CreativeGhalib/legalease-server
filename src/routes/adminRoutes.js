import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { adminMutationRateLimit } from '../middleware/rateLimits.js'
import {
  adminLawyerQuerySchema,
  adminQuerySchema,
  adminTransactionQuerySchema,
  publicationActionSchema,
  roleSchema,
  statusSchema,
} from '../validators/adminValidators.js'
import * as adminController from '../controllers/adminController.js'

const adminRouter = Router()

// All admin routes require authentication and admin role
adminRouter.use(authenticate, authorizeRoles('admin'))

// ─── Users ───────────────────────────────────────────────────────────────────
adminRouter.get('/users', validateQuery(adminQuerySchema), adminController.listUsers)
adminRouter.patch(
  '/users/:id/role',
  adminMutationRateLimit,
  verifyOrigin,
  validate(roleSchema),
  adminController.updateRole,
)
adminRouter.patch(
  '/users/:id/status',
  adminMutationRateLimit,
  verifyOrigin,
  validate(statusSchema),
  adminController.updateStatus,
)

// ─── Lawyers ─────────────────────────────────────────────────────────────────
adminRouter.get('/lawyers', validateQuery(adminLawyerQuerySchema), adminController.listLawyers)
adminRouter.patch(
  '/lawyers/:id/publication',
  adminMutationRateLimit,
  verifyOrigin,
  validate(publicationActionSchema),
  adminController.moderateLawyer,
)
adminRouter.delete(
  '/lawyers/:id',
  adminMutationRateLimit,
  verifyOrigin,
  adminController.deleteLawyer,
)

// ─── Transactions & Analytics ─────────────────────────────────────────────────
adminRouter.get(
  '/transactions',
  validateQuery(adminTransactionQuerySchema),
  adminController.listTransactions,
)
adminRouter.get('/analytics', adminController.analytics)

export default adminRouter

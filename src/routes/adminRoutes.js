import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { validateObjectId } from '../middleware/validateObjectId.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { adminMutationRateLimit } from '../middleware/rateLimits.js'
import {
  adminLawyerQuerySchema,
  adminQuerySchema,
  adminTransactionQuerySchema,
  publicationActionSchema,
  roleSchema,
  statusSchema,
  tierSchema,
  resolveDisputeSchema,
  releaseOverrideSchema,
  disputesQuerySchema,
  auditQuerySchema,
} from '../validators/adminValidators.js'
import * as adminController from '../controllers/adminController.js'

const adminRouter = Router()

// All admin routes require authentication and admin role
adminRouter.use(authenticate, authorizeRoles('admin'))

// ─── Users ───────────────────────────────────────────────────────────────────
adminRouter.get('/users/export', validateQuery(adminQuerySchema), adminController.exportUsersCsv)
adminRouter.get('/users', validateQuery(adminQuerySchema), adminController.listUsers)
adminRouter.patch(
  '/users/:id/role',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(roleSchema),
  adminController.updateRole,
)
adminRouter.patch(
  '/users/:id/status',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(statusSchema),
  adminController.updateStatus,
)

// ─── Lawyers ─────────────────────────────────────────────────────────────────
adminRouter.get('/lawyers/export', validateQuery(adminLawyerQuerySchema), adminController.exportLawyersCsv)
adminRouter.get('/lawyers', validateQuery(adminLawyerQuerySchema), adminController.listLawyers)
adminRouter.patch(
  '/lawyers/:id/publication',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(publicationActionSchema),
  adminController.moderateLawyer,
)
adminRouter.patch(
  '/lawyers/:id/tier',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(tierSchema),
  adminController.updateLawyerTier,
)
adminRouter.delete(
  '/lawyers/:id',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  adminController.deleteLawyer,
)

adminRouter.get('/disputes', validateQuery(disputesQuerySchema), adminController.listDisputes)
adminRouter.get('/audit-logs', validateQuery(auditQuerySchema), adminController.listAuditLogs)
adminRouter.patch(
  '/disputes/:id/resolve',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(resolveDisputeSchema),
  adminController.resolveDispute,
)
adminRouter.post(
  '/transactions/:id/refund',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(releaseOverrideSchema),
  adminController.refundTransactionOverride,
)
adminRouter.post(
  '/transactions/:id/release',
  adminMutationRateLimit,
  verifyOrigin,
  validateObjectId('id'),
  validate(releaseOverrideSchema),
  adminController.releaseEscrowOverride,
)

// ─── Transactions & Analytics ─────────────────────────────────────────────────
adminRouter.get(
  '/transactions/export',
  validateQuery(adminTransactionQuerySchema),
  adminController.exportTransactionsCsv,
)
adminRouter.get(
  '/transactions',
  validateQuery(adminTransactionQuerySchema),
  adminController.listTransactions,
)
adminRouter.get('/analytics', adminController.analytics)

export default adminRouter

import { Router } from 'express'
import { addLeadNote, createLead, exportLeads, listLeads, updateLeadStatus } from '../controllers/leadController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { leadRateLimit, adminMutationRateLimit } from '../middleware/rateLimits.js'
import { validate } from '../middleware/validate.js'
import { validateQuery } from '../middleware/validateQuery.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { createLeadSchema, leadNoteSchema, leadQuerySchema, leadStatusSchema } from '../validators/leadValidators.js'

const leadRouter = Router()

leadRouter.post('/leads', leadRateLimit, verifyOrigin, validate(createLeadSchema), createLead)

leadRouter.use('/admin/leads', authenticate, authorizeRoles('admin'))
leadRouter.get('/admin/leads/export', validateQuery(leadQuerySchema), exportLeads)
leadRouter.get('/admin/leads', validateQuery(leadQuerySchema), listLeads)
leadRouter.patch('/admin/leads/:id/status', adminMutationRateLimit, verifyOrigin, validate(leadStatusSchema), updateLeadStatus)
leadRouter.post('/admin/leads/:id/notes', adminMutationRateLimit, verifyOrigin, validate(leadNoteSchema), addLeadNote)

export default leadRouter

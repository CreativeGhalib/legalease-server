import { Router } from 'express'
import { createMilestone, getCaseTimeline, updateMilestone } from '../controllers/caseTrackerController.js'
import { confirmCaseCompletion } from '../controllers/paymentController.js'
import { deleteCaseDocument, listCaseDocuments, uploadCaseDocument } from '../controllers/caseDocumentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { imageUpload } from './uploadRoutes.js'
import { createMilestoneSchema, updateMilestoneSchema } from '../validators/caseValidators.js'

const caseRouter = Router()

caseRouter.use(authenticate)

caseRouter.get('/:hiringRequestId', getCaseTimeline)
caseRouter.post('/:hiringRequestId/milestones', authorizeRoles('lawyer'), validate(createMilestoneSchema), createMilestone)
caseRouter.patch('/milestones/:id', authorizeRoles('lawyer'), validate(updateMilestoneSchema), updateMilestone)
caseRouter.post('/:hiringRequestId/confirm-completion', confirmCaseCompletion)
caseRouter.post('/:hiringRequestId/documents', imageUpload.single('image'), uploadCaseDocument)
caseRouter.get('/:hiringRequestId/documents', listCaseDocuments)
caseRouter.delete('/documents/:id', deleteCaseDocument)

export default caseRouter

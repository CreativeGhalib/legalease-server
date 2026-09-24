import { Router } from 'express'
import { createMilestone, getCaseTimeline, updateMilestone } from '../controllers/caseTrackerController.js'
import { confirmCaseCompletion } from '../controllers/paymentController.js'
import { deleteCaseDocument, listCaseDocuments, uploadCaseDocument } from '../controllers/caseDocumentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { validateObjectId } from '../middleware/validateObjectId.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { imageUpload, validateImageContents } from './uploadRoutes.js'
import { createMilestoneSchema, updateMilestoneSchema } from '../validators/caseValidators.js'

const caseRouter = Router()

caseRouter.use(authenticate)

caseRouter.get('/:hiringRequestId', validateObjectId('hiringRequestId'), getCaseTimeline)
caseRouter.post('/:hiringRequestId/milestones', verifyOrigin, validateObjectId('hiringRequestId'), authorizeRoles('lawyer'), validate(createMilestoneSchema), createMilestone)
caseRouter.patch('/milestones/:id', verifyOrigin, validateObjectId('id'), authorizeRoles('lawyer'), validate(updateMilestoneSchema), updateMilestone)
caseRouter.post('/:hiringRequestId/confirm-completion', verifyOrigin, validateObjectId('hiringRequestId'), confirmCaseCompletion)
caseRouter.post('/:hiringRequestId/documents', verifyOrigin, validateObjectId('hiringRequestId'), imageUpload.single('image'), validateImageContents, uploadCaseDocument)
caseRouter.get('/:hiringRequestId/documents', validateObjectId('hiringRequestId'), listCaseDocuments)
caseRouter.delete('/documents/:id', verifyOrigin, validateObjectId('id'), deleteCaseDocument)

export default caseRouter

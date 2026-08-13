import { Router } from 'express'
import { createComment, deleteComment, listMine, listPublicComments, updateComment } from '../controllers/commentController.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorizeRoles } from '../middleware/authorizeRoles.js'
import { validate } from '../middleware/validate.js'
import { verifyOrigin } from '../middleware/verifyOrigin.js'
import { commentContentSchema } from '../validators/commentValidators.js'

const commentRouter = Router()
export const lawyerCommentRouter = Router()
lawyerCommentRouter.get('/:profileId/comments', listPublicComments)
lawyerCommentRouter.post('/:profileId/comments', authenticate, authorizeRoles('user'), verifyOrigin, validate(commentContentSchema), createComment)
commentRouter.get('/mine', authenticate, authorizeRoles('user'), listMine)
commentRouter.patch('/:id', authenticate, authorizeRoles('user'), verifyOrigin, validate(commentContentSchema), updateComment)
commentRouter.delete('/:id', authenticate, authorizeRoles('user', 'admin'), verifyOrigin, deleteComment)
export default commentRouter

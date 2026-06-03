import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { startSessionSchema, chatSchema } from '../validators/session.validator.js';
import {
  startSession,
  chatSession,
  getSession,
  completeSession,
  updateSessionState,
} from '../controllers/session.controller.js';

const router = Router();

// All session routes require authentication
router.post('/start', verifyJWT, validate(startSessionSchema), startSession);
router.get('/:id', verifyJWT, getSession);
router.post('/:id/chat', verifyJWT, validate(chatSchema), chatSession);
router.patch('/:id/complete', verifyJWT, completeSession);
router.patch('/:id/state', verifyJWT, validate(updateStateSchema), updateSessionState);

export default router;
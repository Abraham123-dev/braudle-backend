import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { sessionChatLimiter } from '../middleware/rateLimit.middleware.js';
import { startSessionSchema, chatSchema, updateStateSchema } from '../validators/session.validator.js';
import {
  startSession,
  chatSession,
  getSession,
  completeSession,
  updateSessionState,
  getWelcomeMessage,
  getMyFlashcards,
  getDetailedSummary,
  explainSelection,
} from '../controllers/session.controller.js';

const router = Router();

// All session routes require authentication
router.post('/start', verifyJWT, validate(startSessionSchema), startSession);

// Flashcard library — all saved flashcards grouped by document + topic
router.get('/flashcards', verifyJWT, getMyFlashcards);

router.get('/:id', verifyJWT, getSession);
router.get('/:id/welcome', verifyJWT, getWelcomeMessage);
router.get('/:id/detailed-summary', verifyJWT, getDetailedSummary);
router.post('/:id/chat', verifyJWT, sessionChatLimiter, validate(chatSchema), chatSession);
router.post('/:id/explain-selection', verifyJWT, sessionChatLimiter, explainSelection);
router.patch('/:id/complete', verifyJWT, completeSession);
router.patch('/:id/state', verifyJWT, validate(updateStateSchema), updateSessionState);

export default router;
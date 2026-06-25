import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { uploadSingle } from '../middleware/upload.middleware.js';
import {
  getGeneralChat,
  createGeneralChatSession,
  getGeneralChatSessionMessages,
  sendGeneralChatMessage,
  renameGeneralChatSession,
  deleteGeneralChatSession,
} from '../controllers/generalChat.controller.js';

const router = Router();

// All routes require authentication
router.get('/', verifyJWT, getGeneralChat);
router.post('/', verifyJWT, createGeneralChatSession);
router.get('/:id', verifyJWT, getGeneralChatSessionMessages);
router.post('/:id/message', verifyJWT, uploadSingle, sendGeneralChatMessage);
router.put('/:id', verifyJWT, renameGeneralChatSession);
router.delete('/:id', verifyJWT, deleteGeneralChatSession);

export default router;

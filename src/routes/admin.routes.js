import express from 'express';
import { 
  login, 
  logout,
  getStats, 
  getErrorLogs, 
  resolveErrorLog 
} from '../controllers/admin.controller.js';
import { verifyAdminJWT } from '../middleware/admin.middleware.js';

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/logout', logout);

// Protected admin routes
router.get('/stats', verifyAdminJWT, getStats);
router.get('/errors', verifyAdminJWT, getErrorLogs);
router.post('/errors/:id/resolve', verifyAdminJWT, resolveErrorLog);

export default router;

import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { getPerformance, getRecommendations } from '../controllers/dashboard.controller.js';

const router = Router();

// All dashboard routes require authentication
router.use(verifyJWT);

// Get performance overview
router.get('/performance', getPerformance);

// Get personalized recommendations (Ready to test & Weak spots)
router.get('/recommendations', getRecommendations);

export default router;

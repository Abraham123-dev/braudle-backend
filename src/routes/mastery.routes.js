import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { getDueConcepts, submitConceptReview } from '../controllers/mastery.controller.js';

const router = Router();

router.get('/due', verifyJWT, getDueConcepts);
router.post('/review', verifyJWT, submitConceptReview);

export default router;

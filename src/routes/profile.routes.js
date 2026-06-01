import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { onboardingSchema } from '../validators/profile.validator.js';
import { completeOnboarding } from '../controllers/profile.controller.js';

const router = Router();

router.post('/onboarding', verifyJWT, validate(onboardingSchema), completeOnboarding);

export default router;

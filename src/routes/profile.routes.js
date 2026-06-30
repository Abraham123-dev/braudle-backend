import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { uploadSingle } from '../middleware/upload.middleware.js';
import { onboardingSchema } from '../validators/profile.validator.js';
import { updateProfile, getStudentProfile } from '../controllers/profile.controller.js';

const router = Router();

router.post('/onboarding', verifyJWT, uploadSingle, validate(onboardingSchema), updateProfile);
router.put('/', verifyJWT, uploadSingle, updateProfile);
router.get('/', verifyJWT, getStudentProfile);

export default router;

import { Router } from 'express';
import passport from '../config/passport.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import rateLimit from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { logoutSchema, emptyBodySchema, emailLoginSchema, magicLinkSchema, onboardingSchema } from '../validators/auth.validator.js';
import { handleGoogleCallback, getMe, logout, refreshSession, startEmailLogin, verifyMagicLink, updateOnboardingName } from '../controllers/auth.controller.js';

const router = Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${env.frontendUrl}/login`,
  }),
  asyncHandler(handleGoogleCallback)
);

router.get('/me', verifyJWT, asyncHandler(getMe));

router.post('/logout', validate(logoutSchema), asyncHandler(logout));

router.post('/refresh', validate(emptyBodySchema), asyncHandler(refreshSession));

// Magic Link Routes
router.post(
  '/email/start',
  rateLimit('magic_link', 5, 300),
  validate(emailLoginSchema),
  asyncHandler(startEmailLogin)
);
router.post('/email/verify', validate(magicLinkSchema), asyncHandler(verifyMagicLink));

// Onboarding Routes
router.patch('/onboarding/name', verifyJWT, validate(onboardingSchema), asyncHandler(updateOnboardingName));

export default router;

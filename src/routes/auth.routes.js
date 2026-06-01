import { Router } from 'express';
import passport from '../config/passport.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { handleGoogleCallback, getMe, logout, refreshSession } from '../controllers/auth.controller.js';

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

router.post('/logout', asyncHandler(logout));

router.post('/refresh', asyncHandler(refreshSession));

export default router;

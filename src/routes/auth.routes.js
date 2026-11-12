import { Router } from 'express';
import passport from '../config/passport.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import rateLimit from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { logoutSchema, emptyBodySchema, emailLoginSchema, magicLinkSchema, onboardingSchema } from '../validators/auth.validator.js';
import { handleGoogleCallback, getMe, logout, refreshSession, startEmailLogin, verifyMagicLink, updateOnboardingName } from '../controllers/auth.controller.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/google', (req, res, next) => {
  passport.authenticate(
    'google',
    { scope: ['profile', 'email'], session: false }
  )(req, res, (error) => {
      if (error) {
        logger.error(
          {
            provider: 'google',
            phase: 'authorization-start',
            errorName: error.name,
            errorCode: error.code,
            err: error,
          },
          'Google OAuth authorization start failed'
        );
      }
      return next(error);
    });
});

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate(
      'google',
      { session: false },
      (error, user, info) => {
        if (error) {
          logger.error(
            {
              provider: 'google',
              phase: 'callback',
              errorName: error.name,
              errorCode: error.code,
              err: error,
            },
            'Google OAuth callback failed'
          );
          return next(error);
        }

        if (!user) {
          logger.error(
            {
              provider: 'google',
              phase: 'callback',
              info: info?.message || info,
            },
            'Google OAuth callback returned no user'
          );
          return res.redirect(`${env.frontendUrl}/login`);
        }

        return req.logIn(user, { session: false }, (loginError) => {
          if (loginError) {
            logger.error(
              {
                provider: 'google',
                phase: 'callback-login',
                errorName: loginError.name,
                errorCode: loginError.code,
                err: loginError,
              },
              'Google OAuth user login setup failed'
            );
            return next(loginError);
          }
          return next();
        });
      }
    )(req, res, next);
  },
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

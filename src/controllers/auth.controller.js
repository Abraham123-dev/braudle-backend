import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import RefreshToken from '../models/RefreshToken.model.js';
import User from '../models/User.model.js';
import * as AuthService from '../services/auth.service.js';

const ACCESS_COOKIE = 'braudle_token';
const REFRESH_COOKIE = 'braudle_refresh';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'strict' : 'lax',
};

const setAccessCookie = (res, token) => {
  res.cookie(ACCESS_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: ACCESS_COOKIE_MAX_AGE_MS });
};

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: REFRESH_COOKIE_MAX_AGE_MS });
};

const createAccessToken = (userId) =>
  jwt.sign({ id: userId }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });

const createRefreshToken = async (userId) => {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await RefreshToken.create({
    userId,
    token: tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS),
  });

  return rawToken;
};

export const handleGoogleCallback = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new AppError('Authentication failed', 401);
  }

  const accessToken = AuthService.createAccessToken(user._id);
  const refreshToken = await createRefreshToken(user._id);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);

  const redirectPath = user.onboardingComplete ? '/dashboard' : '/onboarding';
  return res.redirect(`${env.frontendUrl}${redirectPath}`);
});

export const getMe = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const user = await User.findById(req.user.id).select('name email avatar role onboardingComplete');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  return res.status(200).json({ user });
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await RefreshToken.findOneAndUpdate(
      { token: tokenHash, revokedAt: { $exists: false } },
      { revokedAt: new Date() }
    );
  }

  res.clearCookie(ACCESS_COOKIE, COOKIE_OPTIONS);
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);

  return res.status(200).json({ message: 'Logged out successfully' });
});

export const refreshSession = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    throw new AppError('No refresh token provided', 401);
  }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const now = new Date();
  const storedToken = await RefreshToken.findOneAndUpdate(
    {
      token: tokenHash,
      expiresAt: { $gt: now },
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
    },
    { revokedAt: now },
    { new: true }
  );

  if (!storedToken) {
    throw new AppError('Invalid refresh token', 401);
  }

  const accessToken = AuthService.createAccessToken(storedToken.userId);
  const newRefreshToken = await createRefreshToken(storedToken.userId);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, newRefreshToken);

  return res.status(200).json({ message: 'Session refreshed' });
});

import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as AuthService from '../services/auth.service.js';
import User from '../models/User.model.js';
import * as EmailService from '../services/email.service.js';

const ACCESS_COOKIE = 'braudle_token';
const REFRESH_COOKIE = 'braudle_refresh';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'strict' : 'lax',
  path: '/',
};

const setAccessCookie = (res, token) => {
  res.cookie(ACCESS_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: ACCESS_COOKIE_MAX_AGE_MS });
};

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: REFRESH_COOKIE_MAX_AGE_MS });
};

export const handleGoogleCallback = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) {
    throw new AppError('Authentication failed', 401);
  }

  const accessToken = AuthService.createAccessToken(user._id);
  const refreshToken = await AuthService.generateRefreshToken(user._id, REFRESH_COOKIE_MAX_AGE_MS);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);

  return res.redirect(env.frontendUrl);
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

  await AuthService.revokeToken(refreshToken);

  res.clearCookie(ACCESS_COOKIE, COOKIE_OPTIONS);
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);

  return res.status(200).json({ message: 'Logged out successfully' });
});

export const refreshSession = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    throw new AppError('No refresh token provided', 401);
  }

  const storedToken = await AuthService.rotateRefreshToken(refreshToken);

  if (!storedToken) {
    throw new AppError('Invalid refresh token', 401);
  }

  const accessToken = AuthService.createAccessToken(storedToken.userId);
  const newRefreshToken = await AuthService.generateRefreshToken(storedToken.userId, REFRESH_COOKIE_MAX_AGE_MS);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, newRefreshToken);

  return res.status(200).json({ message: 'Session refreshed' });
});

export const startEmailLogin = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const token = await AuthService.generateMagicToken(email);
  await EmailService.sendMagicLink(email, token);

  // Generic response to prevent email enumeration
  return res.status(200).json({ 
    message: 'If an account exists with that email, a magic login link has been sent to your inbox.' 
  });
});

export const verifyMagicLink = asyncHandler(async (req, res) => {
  const { token } = req.body;

  const email = await AuthService.verifyMagicToken(token);
  if (!email) {
    throw new AppError('Invalid or expired login link', 401);
  }

  let user = await User.findOne({ email });
  if (!user) {
    // Create new email user with placeholder name for onboarding
    user = await User.create({ email, name: 'New Student', authProvider: 'email' });
  }

  const accessToken = AuthService.createAccessToken(user._id);
  const refreshToken = await AuthService.generateRefreshToken(user._id, REFRESH_COOKIE_MAX_AGE_MS);

  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);

  return res.status(200).json({ user, message: 'Logged in successfully' });
});

export const updateOnboardingName = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;

  const user = await User.findByIdAndUpdate(
    userId,
    { name },
    { new: true, runValidators: true }
  ).select('name email avatar role onboardingComplete');

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return res.status(200).json({ 
    status: 'success', 
    user,
    message: 'Name updated successfully. Proceeding with onboarding.' 
  });
});

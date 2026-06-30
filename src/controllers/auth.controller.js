import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as AuthService from '../services/auth.service.js';
import User from '../models/User.model.js';
import * as EmailService from '../services/email.service.js';

const ACCESS_COOKIE = 'braudle_token';
const REFRESH_COOKIE = 'braudle_refresh';

// Parse JWT_EXPIRES_IN config dynamically to milliseconds for access cookie
const getAccessCookieMaxAge = () => {
  const expiresIn = env.jwt.expiresIn || '15m';
  if (typeof expiresIn === 'number') {
    return expiresIn * 1000;
  }
  
  // Match standard short format: e.g. '30s', '15m', '2h', '7d'
  const match = String(expiresIn).trim().match(/^(\d+)([smhd]?)$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
    }
  }
  
  // Match verbose format: e.g. '2 days', '10 hours', '15 minutes'
  const verboseMatch = String(expiresIn).trim().match(/^(\d+)\s*(sec|second|min|minute|hour|day)s?$/i);
  if (verboseMatch) {
    const value = parseInt(verboseMatch[1], 10);
    const unit = verboseMatch[2].toLowerCase();
    if (unit.startsWith('sec')) return value * 1000;
    if (unit.startsWith('min')) return value * 60 * 1000;
    if (unit.startsWith('hour')) return value * 60 * 60 * 1000;
    if (unit.startsWith('day')) return value * 24 * 60 * 60 * 1000;
  }

  return 15 * 60 * 1000; // Fallback to 15 minutes
};

const ACCESS_COOKIE_MAX_AGE_MS = getAccessCookieMaxAge();
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

  return res.redirect(`${env.frontendUrl}/auth/callback`);
});

export const getMe = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const user = await User.findById(req.user.id).select('name email avatar role onboardingComplete authProvider plan');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const userData = user.toObject();
  // Flag to let frontend know if we should show the "What is your name?" prompt
  userData.needsNameUpdate = user.authProvider === 'email' && user.name === 'New Student';

  return res.status(200).json({ user: userData });
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];

  if (refreshToken) {
    try {
      await AuthService.revokeToken(refreshToken);
    } catch (err) {
      console.error('[AUTH] Failed to revoke refresh token in database during logout:', err);
    }
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

  // Guard: If this email is already registered with Google OAuth only,
  // sending them a magic link creates confusion (they'd log in but authProvider
  // stays 'google'). Return a clear message directing them to Google Sign-In.
  const existingUser = await User.findOne({ email }).select('authProvider googleId');
  if (existingUser && existingUser.authProvider === 'google' && existingUser.googleId) {
    return res.status(409).json({
      status: 'error',
      code: 'GOOGLE_ACCOUNT_EXISTS',
      message: 'This email is linked to a Google account. Please sign in with Google instead.',
    });
  }

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

  const userData = user.toObject();
  // Consistency: add the flag to the initial login response as well
  userData.needsNameUpdate = user.authProvider === 'email' && user.name === 'New Student';

  return res.status(200).json({ user: userData, message: 'Logged in successfully' });
});

export const updateOnboardingName = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;

  const singleName = name.trim().split(/\s+/)[0];

  // 1. Prevent users from manually setting their name to the placeholder string
  if (singleName.toLowerCase() === 'new student') {
    throw new AppError("Invalid name. Please provide your actual name.", 400);
  }

  // 2. Atomic update: only change the name if it is currently the 'New Student' placeholder.
  // This prevents users from reusing this onboarding endpoint to change their name later.
  const user = await User.findOneAndUpdate(
    { _id: userId, name: 'New Student' },
    { name: singleName },
    { returnDocument: 'after', runValidators: true }
  ).select('name email avatar role onboardingComplete authProvider');

  if (!user) {
    throw new AppError('Name has already been set or user not found', 400);
  }

  return res.status(200).json({ 
    status: 'success', 
    user,
    message: `Welcome aboard, ${name}! Let's customize your tutoring profile next.` 
  });
});

// Rate limiting middleware
// Uses express-rate-limit with Redis store for flexible per-feature rate limits

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';
import { env } from '../config/env.js';

const isDev = env.nodeEnv === 'development';

export const getPdfUploadMax = (req) => {
  if (isDev) return 50;
  if (req.user?.role === 'admin' || req.user?.plan === 'pro') return 1000;
  if (req.user?.plan === 'plus') return 10;
  return 5;
};

export const getImageUploadMax = (req) => {
  if (isDev) return 100;
  if (req.user?.role === 'admin' || req.user?.plan === 'plus' || req.user?.plan === 'pro') return 1000;
  return 20;
};

export const getChatMax = (req) => {
  if (isDev) return 1000;
  if (req.user?.role === 'admin' || req.user?.plan === 'plus' || req.user?.plan === 'pro') return 500;
  return 60;
};

export const getQuizGenMax = (req) => {
  if (isDev) return 100;
  if (req.user?.role === 'admin' || req.user?.plan === 'pro') return 1000;
  if (req.user?.plan === 'plus') return 5;
  return 5;
};

// ─── Shared Redis store helper ────────────────────────────────────────────────
const makeStore = (prefix) => new RedisStore({
  sendCommand: (...args) => redisClient.call(...args),
  prefix: `rl:${prefix}:`,
});

// Global rate limiter: 300 req / 15 min (10,000 in dev)
// Redis-backed so limits are enforced across all server instances.
export const globalLimiter = rateLimit({
  store: makeStore('global'),
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 300,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// PDF upload limiter: daily quota per user (Free: 5, Plus: 10, Pro: unlimited)
export const uploadPdfLimiter = rateLimit({
  store: makeStore('pdf'),
  windowMs: 24 * 60 * 60 * 1000,
  max: getPdfUploadMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of PDF uploads per day',
  statusCode: 429,
});

// Image upload limiter: daily quota per user (Free: 20, Plus/Pro: unlimited)
export const uploadImageLimiter = rateLimit({
  store: makeStore('image'),
  windowMs: 24 * 60 * 60 * 1000,
  max: getImageUploadMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of image uploads per day',
  statusCode: 429,
});

// Presign burst limiter: max 5 presign requests per minute per user.
// Prevents signed-URL abuse — a client cannot spam 100 PUT-authorized R2 URLs
// without ever completing an upload.
export const presignBurstLimiter = rateLimit({
  store: makeStore('presign'),
  windowMs: 60 * 1000,
  max: isDev ? 100 : 5,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many upload requests. Please wait a moment before trying again.',
  statusCode: 429,
});

// Session chat limiter: dynamic per-plan (Free: 60/hr, Pro/Admin: 500/hr, Dev: 1000/hr)
export const sessionChatLimiter = rateLimit({
  store: makeStore('chat'),
  windowMs: 60 * 60 * 1000,
  max: getChatMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many messages. Please wait before sending another.',
  statusCode: 429,
});

// Quiz submission limiter: 10 / hr per user (200 in dev)
export const quizLimiter = rateLimit({
  store: makeStore('quiz'),
  windowMs: 60 * 60 * 1000,
  max: isDev ? 200 : 10,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many quiz submissions. Please wait before trying again.',
  statusCode: 429,
});

// Quiz generation limiter: daily quota per user
export const quizGenerationLimiter = rateLimit({
  store: makeStore('quiz_gen'),
  windowMs: 24 * 60 * 60 * 1000,
  max: getQuizGenMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of quiz generations per day. Please try again tomorrow.',
  statusCode: 429,
});

// Auth limiter: 3 magic-link emails per 15 min (100 in dev)
export const authRateLimiter = rateLimit({
  store: makeStore('auth_email'),
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 3,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many requests, please try again later.',
  statusCode: 429,
});

/**
 * Factory: create a one-off rate limiter for ad-hoc routes.
 */
const createRateLimiter = (prefix, max, windowSeconds) => rateLimit({
  store: makeStore(prefix),
  windowMs: windowSeconds * 1000,
  max: isDev ? 1000 : max,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many requests, please try again later.',
  statusCode: 429,
});

export default createRateLimiter;

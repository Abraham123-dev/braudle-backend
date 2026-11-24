// Rate limiting middleware
// Uses express-rate-limit with Redis store for flexible per-feature rate limits

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';
import { env } from '../config/env.js';
import { getAbuseLimitConfig, getGlobalLimiterConfig } from '../config/abuseLimits.js';

const isDev = env.nodeEnv === 'development';
const abuseLimitConfig = getAbuseLimitConfig(isDev);
const globalLimitConfig = getGlobalLimiterConfig(isDev);

export const getChatMax = (req) => {
  if (isDev) return 1000;
  if (req.user?.role === 'admin' || req.user?.plan === 'plus' || req.user?.plan === 'pro') return 500;
  return 60;
};

// ─── Shared Redis store helper ────────────────────────────────────────────────
const makeStore = (prefix) => new RedisStore({
  sendCommand: (...args) => redisClient.call(...args),
  prefix: `rl:${prefix}:`,
});

// Global IP rate limiter: 300 req / 15 min (10,000 in dev).
// This limiter runs on every HTTP request, so it deliberately uses the
// express-rate-limit memory store. The Redis Store is reserved for abuse
// limiters on explicitly sensitive or expensive endpoints.
export const globalLimiter = rateLimit({
  windowMs: globalLimitConfig.windowMs,
  max: globalLimitConfig.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Presign burst limiter: max 5 presign requests per minute per user.
// Prevents signed-URL abuse — a client cannot spam 100 PUT-authorized R2 URLs
// without ever completing an upload.
export const presignBurstLimiter = rateLimit({
  store: makeStore('presign'),
  windowMs: abuseLimitConfig.presign.windowMs,
  max: abuseLimitConfig.presign.max,
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

// Short abuse limiter only. Daily plan quotas are enforced atomically in MongoDB.
export const quizGenerationBurstLimiter = rateLimit({
  store: makeStore('quiz_gen_burst'),
  windowMs: abuseLimitConfig.quizGeneration.windowMs,
  max: abuseLimitConfig.quizGeneration.max,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many quiz requests. Please wait before trying again.',
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

// Rate limiting middleware
// Uses express-rate-limit with Redis store for flexible per-feature rate limits

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';
import { env } from '../config/env.js';

const isDev = env.nodeEnv === 'development';

export const getPdfUploadMax = (req) => {
  if (isDev) return 50;
  if (req.user?.role === 'admin' || req.user?.plan === 'large') return 1000;
  if (req.user?.plan === 'plus') return 10;
  return 5;
};

export const getImageUploadMax = (req) => {
  if (isDev) return 100;
  if (req.user?.role === 'admin' || req.user?.plan === 'plus' || req.user?.plan === 'large') return 1000;
  return 20;
};

export const getChatMax = (req) => {
  if (isDev) return 1000;
  if (req.user?.role === 'admin' || req.user?.plan === 'plus' || req.user?.plan === 'large') {
    return 500;
  }
  return 60;
};

export const getQuizGenMax = (req) => {
  if (isDev) return 100;
  if (req.user?.role === 'admin' || req.user?.plan === 'large') return 1000;
  if (req.user?.plan === 'plus') return 5;
  return 5;
};

// Global rate limiter: 300 requests per 15 minutes (relaxed to 10,000 in dev)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 10000 : 300,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Upload rate limiter: PDF uploads per day per user (Free: 5, Plus: 10, Large: Unlimited)
const uploadPdfLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:pdf:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: getPdfUploadMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of PDF uploads per day',
  statusCode: 429,
});

// Image upload rate limiter: Image uploads per day per user (Free: 20, Plus/Large: Unlimited)
const uploadImageLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:image:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: getImageUploadMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of image uploads per day',
  statusCode: 429,
});

// Session chat rate limiter: dynamic limit (Free: 60/hr, Pro/Admin: 500/hr, Dev: 1000/hr)
const sessionChatLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:chat:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: getChatMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many messages. Please wait before sending another.',
  statusCode: 429,
});

// Quiz rate limiter: 10 submissions per hour per user (relaxed to 200 in dev)
const quizLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:quiz:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 200 : 10,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many quiz submissions. Please wait before trying again.',
  statusCode: 429,
});

// Quiz generation rate limiter: Quiz generations per day per user (Free: 5, Plus: 10, Large: Unlimited)
const quizGenerationLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:quiz_gen:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: getQuizGenMax,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of quiz generations per day. Please try again tomorrow.',
  statusCode: 429,
});

/**
 * Factory function to create dynamic rate limiters with Redis store.
 * Useful for specific routes like magic link generation.
 */
const createRateLimiter = (prefix, max, windowSeconds) => rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  }),
  windowMs: windowSeconds * 1000,
  max: isDev ? 1000 : max,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many requests, please try again later.',
  statusCode: 429,
});

// Auth rate limiter: 3 magic links per 15 minutes (relaxed to 100 in dev)
const authRateLimiter = createRateLimiter('auth_email', isDev ? 100 : 3, 15 * 60);

export { 
  globalLimiter, uploadPdfLimiter, uploadImageLimiter, 
  sessionChatLimiter, quizLimiter, quizGenerationLimiter,
  authRateLimiter 
};
export default createRateLimiter;

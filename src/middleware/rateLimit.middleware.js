// Rate limiting middleware
// Uses express-rate-limit with Redis store for flexible per-feature rate limits

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';

// Global rate limiter: 300 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Upload rate limiter: 2 PDFs per day per user
const uploadPdfLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:pdf:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 2, // 2 uploads per day
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of 2 PDF uploads per day',
  statusCode: 429,
});

// Image upload rate limiter: 5 images per day per user
const uploadImageLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:image:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 uploads per day
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of 5 image uploads per day',
  statusCode: 429,
});

// Session chat rate limiter: 60 messages per hour per user
const sessionChatLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:chat:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60, // 60 messages per hour
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many messages. Please wait before sending another.',
  statusCode: 429,
});

// Quiz rate limiter: 10 submissions per hour per user
const quizLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:quiz:',
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 quiz submissions per hour
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many quiz submissions. Please wait before trying again.',
  statusCode: 429,
});

// Quiz generation rate limiter: 5 generations per day per user
const quizGenerationLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'rl:quiz_gen:',
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 quiz generations per day
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'You have reached the limit of 5 quiz generations per day. Please try again tomorrow.',
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
  max,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: 'Too many requests, please try again later.',
  statusCode: 429,
});

// Auth rate limiter: 3 magic links per 15 minutes
const authRateLimiter = createRateLimiter('auth_email', 3, 15 * 60);

export { 
  globalLimiter, uploadPdfLimiter, uploadImageLimiter, 
  sessionChatLimiter, quizLimiter, quizGenerationLimiter,
  authRateLimiter 
};
export default createRateLimiter;

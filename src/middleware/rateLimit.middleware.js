// Rate limiting middleware
// Uses Redis for flexible per-feature rate limits

import { redisClient } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

const rateLimit = (key, limit, windowSeconds = 3600) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      const rateLimitKey = `${key}:${userId}`;
      const current = await redisClient.incr(rateLimitKey);

      if (current === 1) {
        await redisClient.expire(rateLimitKey, windowSeconds);
      }

      if (current > limit) {
        throw new AppError(`Rate limit exceeded. Max ${limit} requests per ${windowSeconds}s`, 429);
      }

      res.set('X-RateLimit-Remaining', limit - current);
      next();
    } catch (error) {
      throw error;
    }
  };
};

export { rateLimit };

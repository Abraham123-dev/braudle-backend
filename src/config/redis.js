import redis from 'ioredis';
import { env } from './env.js';

const redisClient = new redis(env.redisUrl, {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('connect', () => {
  console.log('Redis connected successfully');
});

redisClient.on('error', (err) => {
  console.error(' Redis error:', err.message);
});

redisClient.on('close', () => {
  console.warn(' Redis connection closed');
});

export { redisClient };

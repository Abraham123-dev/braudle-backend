import redis from 'ioredis';
import { env } from './env.js';

let consecutiveFailures = 0;
let breakerTripped = false;
let breakerResetTime = 0;

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30000; // 30 seconds

export const isRedisHealthy = () => {
  if (breakerTripped) {
    if (Date.now() > breakerResetTime) {
      breakerTripped = false;
      consecutiveFailures = 0;
      console.warn('🔌 [REDIS] Circuit breaker cooldown expired. Retrying connection...');
      return true;
    }
    return false;
  }
  return true;
};

export const recordRedisFailure = () => {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD && !breakerTripped) {
    breakerTripped = true;
    breakerResetTime = Date.now() + COOLDOWN_MS;
    console.error(`🚨 [REDIS] Circuit breaker TRIPPED after ${FAILURE_THRESHOLD} consecutive failures. Bypassing Redis cache for ${COOLDOWN_MS / 1000}s.`);
  }
};

export const recordRedisSuccess = () => {
  consecutiveFailures = 0;
  breakerTripped = false;
};

const redisClient = new redis(env.redisUrl, {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  commandTimeout: 5000,   // Command fails fast (5s) if server hangs
  connectTimeout: 5000,   // Connection fails fast (5s) if server is unreachable
});

redisClient.on('connect', () => {
  console.log('Redis connected successfully');
  recordRedisSuccess();
});

redisClient.on('error', (err) => {
  console.error(' Redis error:', err.message);
  recordRedisFailure();
});

redisClient.on('close', () => {
  console.warn(' Redis connection closed');
  recordRedisFailure();
});

export { redisClient };


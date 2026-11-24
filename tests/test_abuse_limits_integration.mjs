import assert from 'node:assert/strict';
import { redisClient, isRedisHealthy } from '../src/config/redis.js';

const prefix = `braudle:test:abuse:${process.pid}:${Date.now()}`;
const key = `${prefix}:quiz`;

try {
  if (!isRedisHealthy()) {
    throw new Error('Redis circuit breaker is open');
  }

  await redisClient.del(key);
  await redisClient.set(key, '0', 'EX', 60);

  const counts = [];
  for (let i = 0; i < 12; i += 1) {
    counts.push(await redisClient.incr(key));
  }

  assert.equal(counts[0], 1);
  assert.equal(counts[11], 12);

  const ttl = await redisClient.ttl(key);
  assert(ttl > 0 && ttl <= 60, 'Abuse window should expire within 60 seconds');

  await redisClient.del(key);
  console.log('Redis abuse-window integration: passed');
} finally {
  await redisClient.del(key).catch(() => {});
  redisClient.disconnect();
}

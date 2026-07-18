import { redisClient } from '../src/config/redis.js';
import { env } from '../src/config/env.js';

console.log('Using Redis URL:', env.redisUrl);

async function test() {
  try {
    console.log('Sending PING to Redis...');
    const reply = await redisClient.ping();
    console.log('Redis Ping reply:', reply);
  } catch (err) {
    console.error('Redis Ping error:', err);
  } finally {
    redisClient.disconnect();
    process.exit(0);
  }
}

test();

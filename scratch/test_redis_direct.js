import Redis from 'ioredis';

console.log('Connecting directly to Redis...');
const redis = new Redis('redis://localhost:6379');

async function run() {
  try {
    console.log('Sending PING...');
    const reply = await redis.ping();
    console.log('Direct PING reply:', reply);
  } catch (err) {
    console.error('Direct PING error:', err);
  } finally {
    redis.disconnect();
    process.exit(0);
  }
}

run();

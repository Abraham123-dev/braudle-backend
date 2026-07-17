/**
 * flush-bullmq-versions.js
 *
 * Clears stale BullMQ internal Lua-script version keys from Redis.
 *
 * WHY THIS IS NEEDED:
 * BullMQ stores its Lua script version in a Redis key like:
 *   {braudle:v5}:document-extraction:meta
 *
 * When you upgrade BullMQ (even within v5), the internal script version
 * number changes. If the Queue process (API server) and the Worker process
 * load different BullMQ patch versions, their cached script versions diverge
 * and BullMQ throws:
 *   "The API version X does not match the Worker version Y"
 *
 * WHEN TO RUN:
 *   - After upgrading bullmq in package.json
 *   - After seeing the "API version does not match Worker version" error
 *   - Before deploying a new BullMQ version to Render
 *
 * HOW TO RUN:
 *   node scripts/flush-bullmq-versions.js
 *
 * SAFE TO RUN IN PRODUCTION:
 *   - Only deletes BullMQ internal version/meta keys (prefix: {braudle:v5})
 *   - Does NOT delete job data, results, or any application data
 *   - BullMQ re-creates these keys automatically on next start
 */

import Redis from 'ioredis';
import { config } from 'dotenv';

config();

const REDIS_URL = process.env.REDIS_URL;
const QUEUE_PREFIX = '{braudle:v5}';

if (!REDIS_URL) {
  console.error('❌ REDIS_URL env var not set. Aborting.');
  process.exit(1);
}

const client = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

async function flushBullMQVersionKeys() {
  console.log('🔌 Connecting to Redis...');
  await client.connect();
  console.log('✅ Connected.\n');

  console.log(`🔍 Scanning for BullMQ version/meta keys under prefix: "${QUEUE_PREFIX}"\n`);

  let cursor = '0';
  const keysToDelete = [];

  do {
    // SCAN is safe on production — it's non-blocking unlike KEYS
    const [nextCursor, keys] = await client.scan(
      cursor,
      'MATCH', `${QUEUE_PREFIX}*:meta`,
      'COUNT', 100
    );
    cursor = nextCursor;
    keysToDelete.push(...keys);
  } while (cursor !== '0');

  if (keysToDelete.length === 0) {
    console.log('✅ No stale BullMQ version keys found. Nothing to flush.');
  } else {
    console.log(`🗑  Found ${keysToDelete.length} stale key(s):`);
    keysToDelete.forEach(k => console.log(`   - ${k}`));

    await client.del(...keysToDelete);
    console.log(`\n✅ Deleted ${keysToDelete.length} key(s). BullMQ will re-create them with the correct version on next start.`);
  }

  await client.quit();
  console.log('\n🏁 Done. Restart your API server and Worker now.');
}

flushBullMQVersionKeys().catch((err) => {
  console.error('❌ Failed:', err.message);
  client.quit().catch(() => {});
  process.exit(1);
});

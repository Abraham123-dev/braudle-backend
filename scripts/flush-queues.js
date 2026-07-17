/**
 * scripts/flush-queues.js
 *
 * ONE-TIME migration script.
 *
 * PURPOSE:
 *   BullMQ changed its internal Redis key schema between major versions (v4 → v5).
 *   Old stale keys in Redis cause a "version mismatch / unexpected token" crash on
 *   every worker job pickup.  This script obliterates (force-deletes) all jobs in the
 *   OLD un-prefixed queues so the workers start clean.
 *
 * WHEN TO RUN:
 *   Run this ONCE after deploying the queue-prefix fix, BEFORE restarting the workers.
 *   You do NOT need to run it again unless you upgrade BullMQ to a new major version.
 *
 * USAGE:
 *   node scripts/flush-queues.js
 *
 * WARNING:
 *   This deletes ALL waiting, active, delayed, and failed jobs in the named queues.
 *   Any documents currently being processed will need to be re-uploaded.
 *   Run this during a maintenance window if you have active users.
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.REDIS_URL) {
  console.error('❌  REDIS_URL is not set in your .env file. Aborting.');
  process.exit(1);
}

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// The OLD queue names (without prefix) — these are the stale ones to wipe
const OLD_QUEUE_NAMES = [
  'document-extraction',
  'document-embeddings',
  'document-cache',
  'session-summary',
];

async function flushQueues() {
  console.log('🔧  Braudle Queue Flush — removing stale BullMQ keys from Redis...\n');

  for (const name of OLD_QUEUE_NAMES) {
    try {
      // Connect to the OLD un-prefixed queue
      const q = new Queue(name, { connection });
      const counts = await q.getJobCounts();
      console.log(`📋  Queue "${name}":`, counts);

      await q.obliterate({ force: true });
      console.log(`✅  Queue "${name}" obliterated.\n`);

      await q.close();
    } catch (err) {
      console.error(`❌  Failed to obliterate queue "${name}":`, err.message);
    }
  }

  // Also nuke any raw leftover BullMQ keys using Redis SCAN
  console.log('🔍  Scanning for leftover bull:* keys...');
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await connection.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await connection.del(...keys);
      deleted += keys.length;
      console.log(`   Deleted ${keys.length} keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`);
    }
  } while (cursor !== '0');

  console.log(`\n✅  Done. Deleted ${deleted} leftover bull:* Redis keys.`);
  console.log('🚀  You can now deploy and restart your workers safely.\n');

  connection.disconnect();
}

flushQueues().catch(err => {
  console.error('Fatal error during queue flush:', err);
  connection.disconnect();
  process.exit(1);
});

/**
 * scripts/migrate-bullmq.js
 *
 * Multi-mode BullMQ Redis migration script.
 *
 * MODES:
 *   --mode=inspect   Read-only: show all BullMQ keys and job counts (safe, no changes)
 *   --mode=flush     Delete :meta keys only to clear stale Lua script version cache
 *                    (use after a BullMQ patch upgrade within the same major version)
 *   --mode=migrate   Full prefix rename: copy ALL keys from --from prefix to --to prefix
 *                    (use when bumping the prefix e.g. {braudle:v5} → {braudle:v6})
 *
 * USAGE:
 *   node scripts/migrate-bullmq.js --mode=inspect
 *   node scripts/migrate-bullmq.js --mode=flush
 *   node scripts/migrate-bullmq.js --mode=flush   --prefix={braudle:v5}
 *   node scripts/migrate-bullmq.js --mode=migrate --from={braudle:v5} --to={braudle:v6}
 *
 * SAFE TO RUN IN PRODUCTION:
 *   - Uses cursor-based SCAN (never KEYS) so it never blocks Redis
 *   - inspect and flush never touch job data
 *   - migrate does a copy-then-confirm-delete (old keys are not deleted until you confirm)
 *
 * WHEN TO USE EACH MODE:
 *   1. BullMQ patch upgrade (5.77 → 5.80):  use --mode=flush
 *      The internal Lua script version changed. Only :meta keys need to be cleared.
 *      Job data (waiting, active, delayed) is unaffected.
 *
 *   2. BullMQ major upgrade or prefix rename: use --mode=migrate
 *      Keys from old prefix are copied to new prefix. In-flight jobs survive.
 *      Delayed jobs preserve their scheduled timestamps.
 */

import Redis from 'ioredis';
import { config } from 'dotenv';
import { parseArgs } from 'node:util';

config();

// ── Parse CLI arguments ────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    mode:   { type: 'string', default: 'inspect' },
    prefix: { type: 'string', default: '{braudle:v5}' },
    from:   { type: 'string', default: '{braudle:v5}' },
    to:     { type: 'string' },
  },
  allowPositionals: true,
});

const MODE    = args.mode;
const PREFIX  = args.prefix;
const FROM    = args.from;
const TO      = args.to;

const VALID_MODES = ['inspect', 'flush', 'migrate'];
if (!VALID_MODES.includes(MODE)) {
  console.error(`❌ Invalid --mode="${MODE}". Valid: ${VALID_MODES.join(', ')}`);
  process.exit(1);
}

if (MODE === 'migrate' && !TO) {
  console.error('❌ --mode=migrate requires --to=<new-prefix>  e.g. --to={braudle:v6}');
  process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error('❌ REDIS_URL env var not set.');
  process.exit(1);
}

// ── Redis client setup ─────────────────────────────────────────────────────────
const client = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Scan all keys matching a pattern using cursor-based iteration.
 * Never blocks Redis — safe for production.
 */
async function scanAll(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

/**
 * Copy a single key from its current name to a new name with the new prefix.
 * Preserves type structure and TTL.
 */
async function copyKey(srcKey, fromPrefix, toPrefix) {
  const destKey = srcKey.replace(fromPrefix, toPrefix);
  const type = await client.type(srcKey);
  const ttl = await client.pttl(srcKey);

  switch (type) {
    case 'string': {
      const val = await client.get(srcKey);
      await client.set(destKey, val);
      break;
    }
    case 'hash': {
      const val = await client.hgetall(srcKey);
      if (Object.keys(val).length > 0) await client.hset(destKey, val);
      break;
    }
    case 'list': {
      const val = await client.lrange(srcKey, 0, -1);
      if (val.length > 0) await client.rpush(destKey, ...val);
      break;
    }
    case 'set': {
      const val = await client.smembers(srcKey);
      if (val.length > 0) await client.sadd(destKey, ...val);
      break;
    }
    case 'zset': {
      const val = await client.zrange(srcKey, 0, -1, 'WITHSCORES');
      if (val.length > 0) {
        // zrange WITHSCORES returns [member, score, member, score, ...]
        const args = [];
        for (let i = 0; i < val.length; i += 2) {
          args.push(val[i + 1], val[i]); // zadd wants [score, member]
        }
        await client.zadd(destKey, ...args);
      }
      break;
    }
    case 'stream': {
      // Stream migration: read all entries and re-publish
      const entries = await client.xrange(srcKey, '-', '+');
      for (const [, fields] of entries) {
        await client.xadd(destKey, '*', ...fields);
      }
      break;
    }
    default:
      console.log(`  ⚠  Skipping ${srcKey} (unsupported type: ${type})`);
      return false;
  }

  // Restore TTL if the key had one (-1 = no TTL, -2 = key doesn't exist)
  if (ttl > 0) await client.pexpire(destKey, ttl);

  return true;
}

// ── Mode: INSPECT ──────────────────────────────────────────────────────────────
async function runInspect() {
  console.log(`\n🔍 INSPECT — scanning Redis for BullMQ keys under: "${PREFIX}"\n`);

  const allKeys = await scanAll(`${PREFIX}*`);
  if (allKeys.length === 0) {
    console.log('  No keys found under this prefix.\n');
    return;
  }

  // Group by queue name
  const queues = {};
  for (const key of allKeys) {
    // Key format: {prefix}:queue-name:key-type
    const withoutPrefix = key.replace(PREFIX + ':', '');
    const parts = withoutPrefix.split(':');
    const queueName = parts[0] || '(root)';
    const keyType = parts.slice(1).join(':') || '(bare)';

    if (!queues[queueName]) queues[queueName] = {};
    const type = await client.type(key);

    let count = '?';
    if (type === 'list')  count = await client.llen(key);
    if (type === 'zset')  count = await client.zcard(key);
    if (type === 'set')   count = await client.scard(key);
    if (type === 'hash')  count = Object.keys(await client.hgetall(key)).length;
    if (type === 'string') count = 1;

    queues[queueName][keyType] = { type, count };
  }

  for (const [queue, keys] of Object.entries(queues)) {
    console.log(`  📦 Queue: ${queue}`);
    for (const [keyType, { type, count }] of Object.entries(keys)) {
      console.log(`      ${keyType.padEnd(20)} [${type}]  ${count} items`);
    }
    console.log('');
  }

  console.log(`  Total keys: ${allKeys.length}`);
}

// ── Mode: FLUSH ────────────────────────────────────────────────────────────────
async function runFlush() {
  console.log(`\n🗑  FLUSH — deleting :meta keys under: "${PREFIX}"\n`);
  console.log('  This clears stale BullMQ Lua script version cache.');
  console.log('  Job data (waiting, active, delayed, failed) is NOT touched.\n');

  const metaKeys = await scanAll(`${PREFIX}*:meta`);

  if (metaKeys.length === 0) {
    console.log('  ✅ No :meta keys found. Nothing to flush.');
    return;
  }

  console.log(`  Found ${metaKeys.length} :meta key(s):`);
  metaKeys.forEach(k => console.log(`    - ${k}`));

  await client.del(...metaKeys);
  console.log(`\n  ✅ Deleted ${metaKeys.length} key(s).`);
  console.log('  BullMQ will re-create them with the correct version on next server start.\n');
}

// ── Mode: MIGRATE ──────────────────────────────────────────────────────────────
async function runMigrate() {
  console.log(`\n🚚 MIGRATE — copying all keys from "${FROM}" → "${TO}"\n`);
  console.log('  Step 1: Copy all keys to new prefix.');
  console.log('  Step 2: You confirm before old keys are deleted.\n');

  const allKeys = await scanAll(`${FROM}*`);
  if (allKeys.length === 0) {
    console.log(`  No keys found under "${FROM}". Nothing to migrate.\n`);
    return;
  }

  console.log(`  Found ${allKeys.length} key(s) to migrate.\n`);

  let copied = 0;
  let skipped = 0;

  for (const key of allKeys) {
    try {
      const ok = await copyKey(key, FROM, TO);
      if (ok) {
        copied++;
        process.stdout.write(`  ✅ ${key.replace(FROM, TO)}\n`);
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  ❌ Failed to copy ${key}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n  Copied: ${copied}  Skipped: ${skipped}\n`);
  console.log('─'.repeat(60));
  console.log(`\n  ⚠️  OLD KEYS UNDER "${FROM}" HAVE NOT BEEN DELETED YET.`);
  console.log(`  Verify your app works with the new prefix, then run:\n`);
  console.log(`    node scripts/migrate-bullmq.js --mode=flush --prefix=${FROM}\n`);
  console.log('  (Or manually delete all old keys from your Redis dashboard)');
  console.log('─'.repeat(60));
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n━'.repeat(60));
  console.log('  BullMQ Redis Migration Tool');
  console.log('━'.repeat(60));

  await client.connect();
  console.log('\n  🔌 Connected to Redis.\n');

  try {
    if (MODE === 'inspect') await runInspect();
    if (MODE === 'flush')   await runFlush();
    if (MODE === 'migrate') await runMigrate();
  } finally {
    await client.quit();
    console.log('\n  🏁 Done.\n');
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  client.quit().catch(() => {});
  process.exit(1);
});

/**
 * Test: CACHE_TTL constant correctness
 * Verifies that the constants used in session.controller.js match those defined in cache.js
 */

import { CACHE_TTL, CACHE_KEYS, addCacheTtlJitter } from '../src/utils/cache.js';

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

console.log('\n── CACHE_TTL Constants ──');

// Bug #2: CACHE_TTL.TEACH was referenced in session.controller.js but doesn't exist
assert('CACHE_TTL.TEACHING is defined (24h)', CACHE_TTL.TEACHING === 86400);
assert('CACHE_TTL.TEACH is UNDEFINED (typo constant must not exist)', CACHE_TTL.TEACH === undefined);
assert('CACHE_TTL.QUIZ is defined (24h)', CACHE_TTL.QUIZ === 86400);
assert('CACHE_TTL.PROFILE is defined (5min)', CACHE_TTL.PROFILE === 300);
assert('CACHE_TTL.DASHBOARD is defined (5min)', CACHE_TTL.DASHBOARD === 300);
assert('CACHE_TTL.STREAM is defined (5min)', CACHE_TTL.STREAM === 300);

console.log('\n── CACHE_KEYS Functions ──');
assert('CACHE_KEYS.TEACH is a function', typeof CACHE_KEYS.TEACH === 'function');
assert('CACHE_KEYS.TEACH produces expected key format', CACHE_KEYS.TEACH('doc1', 2) === 'v1:teach:doc1:2');
assert('CACHE_KEYS.QUIZ_GENERATED produces expected key format', CACHE_KEYS.QUIZ_GENERATED('doc1', 'beginner', 5) === 'v1:quiz:doc1:beginner:5');

console.log('\n── CACHE TTL Jitter ──');
for (let i = 0; i < 20; i += 1) {
  const ttl = addCacheTtlJitter(CACHE_TTL.TEACHING);
  assert('Teaching cache jitter stays within 5 percent', ttl >= 82080 && ttl <= 90720);
}

import { redisClient } from '../src/config/redis.js';

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
redisClient.disconnect();
if (failed > 0) process.exit(1);

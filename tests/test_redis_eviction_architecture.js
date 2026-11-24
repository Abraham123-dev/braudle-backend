import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('application does not mutate server eviction policy at runtime', async () => {
  const redisConfig = await readFile(
    new URL('../src/config/redis.js', import.meta.url),
    'utf8'
  );

  assert.equal(redisConfig.includes("config('SET', 'maxmemory-policy'"), false);
  assert.equal(redisConfig.includes('allkeys-lru'), false);
  assert.equal(redisConfig.includes('volatile-lru'), false);
});

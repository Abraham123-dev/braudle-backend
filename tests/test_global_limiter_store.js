import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalLimiterConfig } from '../src/config/abuseLimits.js';

test('global limiter does not configure a Redis Store', () => {
  assert.equal(getGlobalLimiterConfig(false).windowMs, 15 * 60 * 1000);
  assert.equal(getGlobalLimiterConfig(false).max, 300);
  assert.equal(getGlobalLimiterConfig(true).max, 10000);
});

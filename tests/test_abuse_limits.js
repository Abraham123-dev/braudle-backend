import test from 'node:test';
import assert from 'node:assert/strict';
import { getAbuseLimitConfig } from '../src/config/abuseLimits.js';

test('upload abuse limit is a short burst, not a plan entitlement', () => {
  const config = getAbuseLimitConfig(false);
  assert.equal(config.presign.windowMs, 60 * 1000);
  assert.equal(config.presign.max, 5);
});

test('quiz generation abuse limit is separate from the plan generation counter', () => {
  const config = getAbuseLimitConfig(false);
  assert.equal(config.quizGeneration.windowMs, 60 * 1000);
  assert.equal(config.quizGeneration.max, 10);
});

test('chat abuse limit remains independent and changes with plan only', () => {
  assert.equal(getAbuseLimitConfig(false).presign.max, 5);
  assert.equal(getAbuseLimitConfig(true).presign.max, 100);
  assert.equal(getAbuseLimitConfig(true).quizGeneration.max, 100);
});

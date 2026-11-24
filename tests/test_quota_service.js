import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUtcDayKey,
  shouldResetUploadQuota,
  shouldResetGenerationQuota,
  getDailyUploadLimit,
  getDailyGenerationLimit,
} from '../src/services/quota.service.js';
import { AppError } from '../src/utils/AppError.js';

test('UTC day key returns a stable YYYY-MM-DD date', () => {
  assert.equal(getUtcDayKey(new Date('2026-11-23T23:59:59.000Z')), '2026-11-23');
  assert.equal(getUtcDayKey(new Date('2026-11-24T00:00:00.000Z')), '2026-11-24');
  assert.equal(getUtcDayKey(null), null);
  assert.equal(getUtcDayKey(new Date('invalid')), null);
});

test('upload quota is reset only when the stored UTC day differs', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  assert.equal(shouldResetUploadQuota({
    lastUploadDate: new Date('2026-11-22T23:59:59.000Z')
  }, now), true);
  assert.equal(shouldResetUploadQuota({
    lastUploadDate: new Date('2026-11-23T01:00:00.000Z')
  }, now), false);
  assert.equal(shouldResetUploadQuota({}, now), true);
});

test('generation quota reset is independent from upload quota reset', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  assert.equal(shouldResetGenerationQuota({
    lastGenerationResetDate: new Date('2026-11-22T23:59:59.000Z')
  }, now), true);
  assert.equal(shouldResetGenerationQuota({
    lastGenerationResetDate: new Date('2026-11-23T01:00:00.000Z')
  }, now), false);
});

test('upload plan limits are calculated independently of abuse limits', () => {
  assert.equal(getDailyUploadLimit('free', 'student', false), 5);
  assert.equal(getDailyUploadLimit('plus', 'student', false), 10);
  assert.equal(getDailyUploadLimit('pro', 'student', false), 1000);
  assert.equal(getDailyUploadLimit('free', 'admin', false), 1000);
  assert.equal(getDailyUploadLimit('free', 'student', true), 50);
});

test('generation plan limits are per generation type', () => {
  assert.equal(getDailyGenerationLimit('free', 'practice'), 1);
  assert.equal(getDailyGenerationLimit('free', 'exam'), 1);
  assert.equal(getDailyGenerationLimit('plus', 'flashcards'), 10);
  assert.equal(getDailyGenerationLimit('pro', 'practice'), null);
  assert.throws(
    () => getDailyGenerationLimit('free', 'invalid'),
    (error) => error instanceof AppError && error.statusCode === 400
  );
});

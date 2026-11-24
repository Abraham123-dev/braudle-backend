import { redisClient, isRedisHealthy } from '../config/redis.js';

/**
 * Sets a value in Redis with an optional TTL
 * @param {string} key
 * @param {any} value
 * @param {number} ttl - Time to live in seconds (default 24h)
 */
export const setCached = async (key, value, ttl = 86400, jitter = false) => {
  if (!isRedisHealthy()) {
    return;
  }
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const effectiveTtl = jitter ? addCacheTtlJitter(ttl) : ttl;
    await redisClient.set(key, stringValue, 'EX', effectiveTtl);
  } catch (err) {
    console.error(`[CACHE] Set error for key ${key}:`, err.message);
  }
};

export const addCacheTtlJitter = (ttl, jitterPercent = 0.05) => {
  if (!Number.isFinite(ttl) || ttl <= 0) return ttl;
  const jitter = Math.floor(ttl * jitterPercent);
  if (jitter <= 0) return ttl;
  return ttl + Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
};

export const acquireCacheLock = async (key, ttlSeconds = 60) => {
  if (!isRedisHealthy()) return null;

  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    const acquired = await redisClient.set(
      key,
      token,
      'EX',
      ttlSeconds,
      'NX'
    );
    return acquired === 'OK' ? token : null;
  } catch (err) {
    console.error(`[CACHE] Lock acquisition error for key ${key}:`, err.message);
    return null;
  }
};

export const releaseCacheLock = async (key, token) => {
  if (!isRedisHealthy() || !token) return;

  try {
    await redisClient.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0`,
      1,
      key,
      token
    );
  } catch (err) {
    console.error(`[CACHE] Lock release error for key ${key}:`, err.message);
  }
};

/**
 * Gets a value from Redis
 * @param {string} key
 * @returns {any|null}
 */
export const getCached = async (key) => {
  if (!isRedisHealthy()) {
    return null;
  }
  try {
    const value = await redisClient.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (err) {
    console.error(`[CACHE] Get error for key ${key}:`, err.message);
    return null;
  }
};

/**
 * Deletes a value from Redis
 * @param {string} key
 */
export const deleteCached = async (key) => {
  if (!isRedisHealthy()) {
    return;
  }
  try {
    await redisClient.del(key);
  } catch (err) {
    console.error(`[CACHE] Delete error for key ${key}:`, err.message);
  }
};

// Map to track in-flight fetch promises (Promise Coalescing)
const activeRequests = new Map();

/**
 * Promise Coalescing Wrapper (Cache Stampede / Thundering Herd Prevention)
 * If multiple concurrent requests ask for the same key, they await the same promise
 * instead of invoking fetchFn() multiple times.
 */
export const getOrSet = async (key, fetchFn, ttl = 86400) => {
  // 1. Check if the key is already warm in Redis
  const cached = await getCached(key);
  if (cached !== null) {
    return cached;
  }

  // 2. Check if there's already an active database/LLM operation in-flight
  if (activeRequests.has(key)) {
    console.log(`[CACHE] Stampede prevented. Coalescing request for key: ${key}`);
    return activeRequests.get(key);
  }

  // 3. Initiate single-flight request
  const requestPromise = (async () => {
    try {
      const freshValue = await fetchFn();
      if (freshValue !== null && freshValue !== undefined) {
        await setCached(key, freshValue, ttl, true);
      }
      return freshValue;
    } finally {
      activeRequests.delete(key);
    }
  })();

  activeRequests.set(key, requestPromise);
  return requestPromise;
};

export const CACHE_KEYS = {
  TEACH:                (docId, chunkIdx) => `v1:teach:${docId}:${chunkIdx}`,
  QUIZ:                 (documentId) => `v1:quiz:${documentId}`,
  QUIZ_GENERATED:       (sessionId, level, count) => `v1:quiz:${sessionId}:${level}:${count}`,
  QUIZ_CUSTOM:          (sessionId, difficulty, format, numQuestions) => `v1:custom_quiz:${sessionId}:${difficulty}:${format}:${numQuestions}`,
  PROFILE:             (userId) => `v1:profile:${userId}`,
  EMBED:               (docId, chunkIdx) => `v1:embed:${docId}:${chunkIdx}`,
  ACTIVE_STREAM:       (userId) => `v1:ai:stream:${userId}`,
  DASHBOARD_PERF:      (userId) => `v1:dashboard:perf:${userId}`,
};

// Centralised TTL constants (seconds) — change once, applied everywhere
export const CACHE_TTL = {
  TEACHING:   86400,   // 24h  — teaching responses are stable per chunk/level
  QUIZ:       86400,   // 24h  — quiz questions per doc/level don't change
  PROFILE:    300,     // 5min — profile changes after quiz/XP, stale-safe window
  DASHBOARD:  300,     // 5min — aggregation is expensive, fine to lag slightly
  STREAM:     300,     // 5min — safety TTL on the stream concurrency lock
};
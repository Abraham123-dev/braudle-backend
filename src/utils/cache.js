import { redisClient } from '../config/redis.js';

/**
 * Sets a value in Redis with an optional TTL
 * @param {string} key 
 * @param {any} value 
 * @param {number} ttl - Time to live in seconds (default 24h)
 */
export const setCached = async (key, value, ttl = 86400) => {
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await redisClient.set(key, stringValue, 'EX', ttl);
  } catch (err) {
    console.error(`[CACHE] Set error for key ${key}:`, err.message);
  }
};

/**
 * Gets a value from Redis
 * @param {string} key 
 * @returns {any|null}
 */
export const getCached = async (key) => {
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

export const deleteCached = async (key) => {
  try {
    await redisClient.del(key);
  } catch (err) {
    console.error(`[CACHE] Delete error for key ${key}:`, err.message);
  }
};

export const CACHE_KEYS = {
  TEACH:                (docId, chunkIdx, level) => `teach:${docId}:${chunkIdx}:${level}`,
  QUIZ:                 (documentId) => `quiz:${documentId}`,
  PROFILE:             (userId) => `profile:${userId}`,
  EMBED:               (docId, chunkIdx) => `embed:${docId}:${chunkIdx}`,
  ACTIVE_STREAM:       (userId) => `ai:stream:${userId}`,
  DASHBOARD_PERF:      (userId) => `dashboard:perf:${userId}`,
};

// Centralised TTL constants (seconds) — change once, applied everywhere
export const CACHE_TTL = {
  TEACHING:   86400,   // 24h  — teaching responses are stable per chunk/level
  QUIZ:       86400,   // 24h  — quiz questions per doc/level don't change
  PROFILE:    300,     // 5min — profile changes after quiz/XP, stale-safe window
  DASHBOARD:  300,     // 5min — aggregation is expensive, fine to lag slightly
  STREAM:     300,     // 5min — safety TTL on the stream concurrency lock
};
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
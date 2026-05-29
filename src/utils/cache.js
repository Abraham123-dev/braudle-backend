import { redisClient } from '../config/redis.js';

const getCached = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`Cache GET error for ${key}:`, error);
    return null;
  }
};

const setCached = async (key, value, ttlSeconds = 3600) => {
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error(`Cache SET error for ${key}:`, error);
  }
};

const deleteCached = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error(`Cache DELETE error for ${key}:`, error);
  }
};

const clearCachePattern = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (error) {
    console.error(`Cache CLEAR pattern error for ${pattern}:`, error);
  }
};

export { getCached, setCached, deleteCached, clearCachePattern };

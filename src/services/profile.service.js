import StudentProfile from '../models/StudentProfile.model.js';
import { calculateXP, shouldUpgradeLevel } from '../utils/scoreCalculator.js';
import { getCached, setCached, deleteCached, CACHE_KEYS, CACHE_TTL } from '../utils/cache.js';

/**
 * Fetches a student's profile, checking Redis cache first.
 * Called by any controller that needs profile data — avoids repeated MongoDB hits
 * on high-frequency routes like session chat (every message triggers this).
 *
 * Cache TTL: 5 minutes. Short enough to reflect XP/level changes promptly.
 * Invalidation: bust the key explicitly after any profile write.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export const getProfile = async (userId) => {
  const cacheKey = CACHE_KEYS.PROFILE(userId);

  // 1. Try cache first
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // 2. Miss — fetch from MongoDB
  const profile = await StudentProfile.findOne({ userId }).lean();
  if (!profile) return null;

  // 3. Populate cache for next request
  await setCached(cacheKey, profile, CACHE_TTL.PROFILE);

  return profile;
};

/**
 * Updates a student's profile after they submit a quiz.
 * Handles XP calculation, recent scores tracking, and adaptive level upgrades.
 * ALWAYS invalidates the profile cache after saving — keeps cache consistent.
 *
 * @param {string} userId - The user's ID
 * @param {number} score - The percentage score achieved on the quiz
 * @returns {Promise<string>} The new or existing level
 */
export const updateProfileAfterQuiz = async (userId, score) => {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) return null;

  // Calculate and add XP
  const earnedXP = calculateXP(score);
  profile.xp += earnedXP;

  // Track recent scores for adaptive leveling
  if (!profile.recentScores) profile.recentScores = [];
  profile.recentScores.push(score);
  if (profile.recentScores.length > 5) {
    profile.recentScores.shift(); // Keep only the last 5
  }

  // Check for level upgrade
  if (shouldUpgradeLevel(profile.level, profile.recentScores)) {
    profile.level = profile.level === 'beginner' ? 'intermediate' : 'advanced';
  }

  await profile.save();

  // ── Cache Invalidation ────────────────────────────────────────────────────
  // Profile just changed — bust the cache so next read reflects the new XP/level.
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return profile.level;
};

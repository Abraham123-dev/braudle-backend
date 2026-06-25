import StudentProfile from '../models/StudentProfile.model.js';
import Session from '../models/Session.model.js';
import Quiz from '../models/Quiz.model.js';
import { calculateXP, shouldUpgradeLevel } from '../utils/scoreCalculator.js';
import { getOrSet, deleteCached, CACHE_KEYS, CACHE_TTL } from '../utils/cache.js';

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

  return await getOrSet(
    cacheKey,
    async () => {
      const profile = await StudentProfile.findOne({ userId }).lean();
      return profile || null;
    },
    CACHE_TTL.PROFILE
  );
};


/**
 * Updates a student's profile after they submit a quiz.
 * Handles XP calculation, recent scores tracking, and adaptive level upgrades.
 * ALWAYS invalidates the profile cache after saving — keeps cache consistent.
 *
 * @param {string} userId - The user's ID
 * @param {number} score - The percentage score achieved on the quiz
 * @param {Object[]} questions - The graded questions from the quiz
 * @returns {Promise<string>} The new or existing level
 */
export const updateProfileAfterQuiz = async (userId, score, questions = []) => {
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

  // Update streak, longestStreak, lastStudyDate
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (profile.lastStudyDate) {
    const lastDate = new Date(profile.lastStudyDate);
    const lastDateStr = lastDate.toISOString().split('T')[0];

    if (lastDateStr !== todayStr) {
      const msDiff = new Date(todayStr).getTime() - new Date(lastDateStr).getTime();
      const dayDiff = Math.round(msDiff / (1000 * 60 * 60 * 24));

      if (dayDiff === 1) {
        profile.streak = (profile.streak || 0) + 1;
      } else if (dayDiff > 1) {
        profile.streak = 1;
      }
    }
  } else {
    profile.streak = 1;
  }

  profile.lastStudyDate = now;
  if (profile.streak > (profile.longestStreak || 0)) {
    profile.longestStreak = profile.streak;
  }

  // Increment totalSessions
  profile.totalSessions = (profile.totalSessions || 0) + 1;

  // Calculate averageScore from all user's quizzes in the database
  try {
    const userSessions = await Session.find({ userId }).select('_id');
    const sessionIds = userSessions.map(s => s._id);
    const quizzes = await Quiz.find({ 
      sessionId: { $in: sessionIds }, 
      score: { $exists: true, $ne: null } 
    }).select('score');

    const allScores = quizzes.map(q => q.score);
    const sum = allScores.reduce((acc, s) => acc + s, 0) + score;
    profile.averageScore = Math.round(sum / (allScores.length + 1));
  } catch (err) {
    console.error('Error calculating average score:', err);
    profile.averageScore = score;
  }

  // ── Topical Mastery Analysis ──────────────────────────────────────────────
  if (questions.length > 0) {
    const topicStats = {};
    questions.forEach(q => {
      const normalizedTopic = q.topic?.trim();
      if (!normalizedTopic) return;
      
      if (!topicStats[normalizedTopic]) topicStats[normalizedTopic] = { correct: 0, total: 0 };
      topicStats[normalizedTopic].total++;
      if (q.isCorrect) topicStats[normalizedTopic].correct++;
    });

    Object.entries(topicStats).forEach(([topic, stats]) => {
      const accuracy = stats.correct / stats.total;
      if (accuracy >= 0.8) {
        // Strong mastery: Add to strong, remove from weak
        if (!profile.strongTopics.includes(topic)) profile.strongTopics.push(topic);
        profile.weakTopics = profile.weakTopics.filter(t => t.toLowerCase() !== topic.toLowerCase());
      } else if (accuracy <= 0.4) {
        // Struggle detected: Add to weak, remove from strong
        if (!profile.weakTopics.includes(topic)) profile.weakTopics.push(topic);
        profile.strongTopics = profile.strongTopics.filter(t => t.toLowerCase() !== topic.toLowerCase());
      }
    });
  }

  await profile.save();

  // ── Cache Invalidation ────────────────────────────────────────────────────
  // Profile just changed — bust the cache so next read reflects the new XP/level.
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return profile.level;
};
/**
 * Updates a student's profile based on insights extracted from a session transcript.
 * Merges weak and strong topics while ensuring consistency and removing duplicates.
 * 
 * @param {string} userId - The user's ID
 * @param {Object} insights - The analysis results { weakTopics, strongTopics, misconceptions, sessionId }
 * @returns {Promise<Object|null>} The updated profile
 */
export const updateProfileAfterSessionAnalysis = async (userId, { weakTopics = [], strongTopics = [], misconceptions = [], sessionId }) => {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) return null;

  // 1. Process Weak Topics: Add to weak list, ensure removed from strong list
  weakTopics.forEach((topic) => {
    const normalized = topic.trim();
    if (!normalized) return;

    if (!profile.weakTopics.some((t) => t.toLowerCase() === normalized.toLowerCase())) {
      profile.weakTopics.push(normalized);
    }
    profile.strongTopics = profile.strongTopics.filter((t) => t.toLowerCase() !== normalized.toLowerCase());
  });

  // 2. Process Strong Topics: Add to strong list, ensure removed from weak list
  strongTopics.forEach((topic) => {
    const normalized = topic.trim();
    if (!normalized) return;

    if (!profile.strongTopics.some((t) => t.toLowerCase() === normalized.toLowerCase())) {
      profile.strongTopics.push(normalized);
    }
    profile.weakTopics = profile.weakTopics.filter((t) => t.toLowerCase() !== normalized.toLowerCase());
  });

  const validEntries = Array.isArray(misconceptions)
    ? misconceptions.filter(m => m && typeof m.topic === 'string' && m.topic.trim() && typeof m.description === 'string' && m.description.trim())
    : [];

  if (validEntries.length > 0) {
    const historyEntries = validEntries.map(m => ({
      topic: m.topic.trim(),
      description: m.description.trim(),
      sessionId,
      occurredAt: new Date()
    }));
    profile.misconceptionHistory.push(...historyEntries);
  }

  await profile.save();

  // Invalidate cache to reflect changes in high-frequency routes
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return profile;
};

/**
 * Records a study activity (streak, lastStudyDate, totalSessions).
 * Called when starting a session or sending messages, to ensure streak updates.
 * Awarding +10 XP daily learning boost when streak increments or on first study action.
 * Uses a smart short-circuit to exit immediately if they already studied today.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>} The updated profile
 */
export const recordStudyActivity = async (userId) => {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) return null;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (profile.lastStudyDate) {
    const lastDate = new Date(profile.lastStudyDate);
    const lastDateStr = lastDate.toISOString().split('T')[0];

    if (lastDateStr === todayStr) {
      // Already recorded study activity today! Return early to avoid database writes.
      return profile;
    }

    // Calculate diff in days
    const msDiff = new Date(todayStr).getTime() - new Date(lastDateStr).getTime();
    const dayDiff = Math.round(msDiff / (1000 * 60 * 60 * 24));

    if (dayDiff === 1) {
      profile.streak = (profile.streak || 0) + 1;
    } else if (dayDiff > 1) {
      profile.streak = 1;
    }
  } else {
    profile.streak = 1;
  }

  // Award +10 XP daily boost for study activity
  profile.xp = (profile.xp || 0) + 10;
  profile.lastStudyDate = now;
  profile.totalSessions = (profile.totalSessions || 0) + 1;

  if (profile.streak > (profile.longestStreak || 0)) {
    profile.longestStreak = profile.streak;
  }

  await profile.save();
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return profile;
};

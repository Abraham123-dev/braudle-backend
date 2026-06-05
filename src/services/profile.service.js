import StudentProfile from '../models/StudentProfile.model.js';
import { calculateXP, shouldUpgradeLevel } from '../utils/scoreCalculator.js';

/**
 * Updates a student's profile after they submit a quiz.
 * Handles XP calculation, recent scores tracking, and adaptive level upgrades.
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
  return profile.level;
};

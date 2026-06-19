import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import StudentProfile from '../models/StudentProfile.model.js';
import User from '../models/User.model.js';
import * as ProfileService from '../services/profile.service.js';

export const completeOnboarding = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;

  // Check if StudentProfile already exists for this userId
  const existingProfile = await StudentProfile.findOne({ userId });
  if (existingProfile) {
    throw new AppError('Onboarding already completed', 400);
  }

  // Create StudentProfile with fields from req.body
  const { studyLevel, learningStyle, goal, level } = req.body;
  const profile = await StudentProfile.create({
    userId,
    studyLevel,
    learningStyle,
    goal,
    level,
  });

  // Set User.onboardingComplete to true and save
  await User.findByIdAndUpdate(userId, { onboardingComplete: true });

  // Invalidate cache since we just created the profile
  const { deleteCached, CACHE_KEYS } = await import('../utils/cache.js');
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return res.status(200).json({ message: 'Onboarding complete', profile });
});

export const getStudentProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;

  const profile = await ProfileService.getProfile(userId);
  if (!profile) {
    throw new AppError('Student profile not found. Please complete onboarding first.', 404);
  }

  return res.status(200).json(profile);
});

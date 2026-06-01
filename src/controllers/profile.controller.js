import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import StudentProfile from '../models/StudentProfile.model.js';
import User from '../models/User.model.js';

export const completeOnboarding = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;

  // Check if StudentProfile already exists for this userId
  const existingProfile = await StudentProfile.findOne({ userId });
  if (existingProfile) {
    throw new AppError('Onboarding already completed', 400);
  }

  // Create StudentProfile with fields from req.body
  const { studyLevel, subjects, learningStyle, goal, level } = req.body;
  const profile = await StudentProfile.create({
    userId,
    studyLevel,
    subjects,
    learningStyle,
    goal,
    level,
  });

  // Set User.onboardingComplete to true and save
  await User.findByIdAndUpdate(userId, { onboardingComplete: true });

  return res.status(200).json({
    message: 'Onboarding complete',
    profile,
  });
});

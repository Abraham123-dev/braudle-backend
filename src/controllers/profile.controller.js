import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import StudentProfile from '../models/StudentProfile.model.js';
import User from '../models/User.model.js';
import * as ProfileService from '../services/profile.service.js';
import * as StorageService from '../services/storage.service.js';

export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const { studyLevel, learningStyle, goal, level, dailyStudyTarget, motivation } = req.body;
  const file = req.file;

  // Build profile update fields
  const profileUpdate = {};
  if (studyLevel !== undefined) profileUpdate.studyLevel = studyLevel;
  if (learningStyle !== undefined) profileUpdate.learningStyle = learningStyle;
  if (goal !== undefined) profileUpdate.goal = goal;
  if (level !== undefined) profileUpdate.level = level;
  if (dailyStudyTarget !== undefined) profileUpdate.dailyStudyTarget = dailyStudyTarget;
  if (motivation !== undefined) profileUpdate.motivation = motivation;

  // Update StudentProfile. Use upsert: true so it works for onboarding too!
  const profile = await StudentProfile.findOneAndUpdate(
    { userId },
    profileUpdate,
    { returnDocument: 'after', upsert: true }
  );

  const userUpdate = { onboardingComplete: true };

  // If avatar file is uploaded, upload to R2 and set User avatar (with base64 fallback)
  if (file) {
    try {
      const sanitizedName = StorageService.sanitizeFilename(file.originalname);
      const fileKey = `avatars/${userId}/${Date.now()}-${sanitizedName}`;
      const avatarUrl = await StorageService.uploadToR2(file.buffer, fileKey, file.mimetype);
      userUpdate.avatar = avatarUrl;
    } catch (uploadError) {
      console.error('[PROFILE UPLOAD] Cloudflare R2 upload failed. Falling back to base64 data URI:', uploadError.message);
      const base64Image = file.buffer.toString('base64');
      const dataUri = `data:${file.mimetype};base64,${base64Image}`;
      userUpdate.avatar = dataUri;
    }
  }

  const updatedUser = await User.findByIdAndUpdate(userId, userUpdate, { returnDocument: 'after' });

  // Invalidate cached profile
  const { deleteCached, CACHE_KEYS } = await import('../utils/cache.js');
  await deleteCached(CACHE_KEYS.PROFILE(userId));

  return res.status(200).json({ 
    message: 'Profile updated successfully', 
    profile,
    user: {
      id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      avatar: updatedUser.avatar,
      onboardingComplete: updatedUser.onboardingComplete,
      plan: updatedUser.plan
    }
  });
});

export const getStudentProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;

  const profile = await ProfileService.getProfile(userId);
  if (!profile) {
    throw new AppError('Student profile not found. Please complete onboarding first.', 404);
  }

  return res.status(200).json(profile);
});

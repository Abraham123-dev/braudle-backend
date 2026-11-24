import User from '../models/User.model.js';
import { AppError } from '../utils/AppError.js';

export const getUtcDayKey = (date = new Date()) =>
  date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;

export const getDailyUploadLimit = (plan, role = 'student', isDev = false) => {
  if (isDev) return 50;
  if (role === 'admin' || plan === 'pro') return 1000;
  if (plan === 'plus') return 10;
  return 5;
};

export const getDailyGenerationLimit = (plan, type) => {
  if (!['flashcards', 'practice', 'exam'].includes(type)) {
    throw new AppError('Invalid generation quota type', 400);
  }
  if (plan === 'pro') return null;
  if (plan === 'plus') return 10;
  return 1;
};

export const shouldResetUploadQuota = (user, now = new Date()) =>
  getUtcDayKey(user?.lastUploadDate || null) !== getUtcDayKey(now);

export const shouldResetGenerationQuota = (user, now = new Date()) =>
  getUtcDayKey(user?.lastGenerationResetDate || null) !== getUtcDayKey(now);

export const resetDailyUploadQuota = async (userId, now = new Date()) => {
  const today = getUtcDayKey(now);

  return User.findByIdAndUpdate(
    userId,
    [
      {
        $set: {
          uploadCount: {
            $cond: [
              { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$lastUploadDate', timezone: 'UTC' } }, today] },
              '$uploadCount',
              { pdf: 0, image: 0 }
            ]
          },
          lastUploadDate: {
            $cond: [
              { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$lastUploadDate', timezone: 'UTC' } }, today] },
              '$lastUploadDate',
              now
            ]
          }
        }
      }
    ],
    { updatePipeline: true, returnDocument: 'after' }
  );
};

export const resetDailyGenerationQuota = async (userId, now = new Date()) => {
  const today = getUtcDayKey(now);

  return User.findByIdAndUpdate(
    userId,
    [
      {
        $set: {
          dailyGenerationsCount: {
            $cond: [
              { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$lastGenerationResetDate', timezone: 'UTC' } }, today] },
              '$dailyGenerationsCount',
              { flashcards: 0, practice: 0, exam: 0 }
            ]
          },
          lastGenerationResetDate: {
            $cond: [
              { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$lastGenerationResetDate', timezone: 'UTC' } }, today] },
              '$lastGenerationResetDate',
              now
            ]
          }
        }
      }
    ],
    { updatePipeline: true, returnDocument: 'after' }
  );
};

export const consumeGenerationQuota = async (userId, type) => {
  const resetUser = await resetDailyGenerationQuota(userId);
  if (!resetUser) return null;

  const plan = resetUser.plan || 'free';
  if (plan === 'pro') return resetUser;

  const limit = getDailyGenerationLimit(plan, type);
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      [`dailyGenerationsCount.${type}`]: { $lt: limit }
    },
    {
      $inc: { [`dailyGenerationsCount.${type}`]: 1 },
      $set: { lastGenerationResetDate: new Date() }
    },
    { returnDocument: 'after' }
  );

  if (!updatedUser) {
    throw new AppError(
      plan === 'plus'
        ? `You've reached your daily limit of 10 ${type} generations for the Plus plan. Upgrade to Pro for unlimited access.`
        : `You've reached your daily limit of 1 ${type} generation. Upgrade to Plus or Pro for more.`,
      429
    );
  }

  return updatedUser;
};

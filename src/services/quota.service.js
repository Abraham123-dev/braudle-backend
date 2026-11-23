import User from '../models/User.model.js';

export const getUtcDayKey = (date = new Date()) =>
  date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;

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

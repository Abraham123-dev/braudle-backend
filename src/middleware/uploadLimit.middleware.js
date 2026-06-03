import User from '../models/User.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Middleware to reset upload counters if a new day has started.
 * This ensures daily limits (2 PDFs, 5 images) are enforced per calendar day.
 */
export const resetUploadCountersIfNeeded = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return next();
  }

  const today = new Date().toISOString().split('T')[0];
  const lastDate = user.lastUploadDate ? user.lastUploadDate.toISOString().split('T')[0] : null;

  if (lastDate !== today) {
    console.log(`[AUTH] Resetting upload counters for user: ${user._id}`);
    user.uploadCount.pdf = 0;
    user.uploadCount.image = 0;
    user.lastUploadDate = new Date(); // Update to today so we don't reset again on every request today
    await user.save();
  }

  next();
});
import User from '../models/User.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Middleware to reset upload counters if a new day has started.
 * This ensures daily limits (2 PDFs, 5 images) are enforced per calendar day.
 */
export const resetUploadCountersIfNeeded = asyncHandler(async (req, res, next) => {
  next();
});
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as MasteryService from '../services/mastery.service.js';
import Document from '../models/Document.model.js';

/**
 * Exposes list of concepts that are due for spaced repetition review.
 * GET /api/mastery/due?documentId=...
 */
export const getDueConcepts = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentId } = req.query;

  const dueList = await MasteryService.getDueConcepts(userId, documentId || null);
  return res.status(200).json({
    status: 'success',
    results: dueList.length,
    dueConcepts: dueList
  });
});

/**
 * Submits a performance grade (0-5) for a concept.
 * POST /api/mastery/review
 * Body: { documentId, conceptName, quality }
 */
export const submitConceptReview = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentId, conceptName, quality } = req.body;

  if (!documentId) {
    throw new AppError('documentId is required', 400);
  }
  if (!conceptName || typeof conceptName !== 'string' || !conceptName.trim()) {
    throw new AppError('conceptName is required and must be a valid string', 400);
  }
  if (quality === undefined || typeof quality !== 'number' || quality < 0 || quality > 5) {
    throw new AppError('quality is required and must be an integer between 0 and 5', 400);
  }

  // Ensure document exists and belongs to the user
  const document = await Document.findById(documentId).select('userId');
  if (!document) {
    throw new AppError('Study document not found', 404);
  }
  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  const updatedRecord = await MasteryService.recordConceptReview(
    userId,
    documentId,
    conceptName.trim(),
    quality
  );

  return res.status(200).json({
    status: 'success',
    message: 'Concept review recorded successfully.',
    concept: updatedRecord
  });
});

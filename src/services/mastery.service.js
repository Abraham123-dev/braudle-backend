import MasteryConcept from '../models/MasteryConcept.model.js';

/**
 * Calculates updated SM-2 parameters based on the quality score (0-5).
 *
 * @param {number} quality - Grading quality (0-5)
 * @param {number} repetitions - Previous successful repetitions
 * @param {number} interval - Previous interval in days
 * @param {number} easeFactor - Previous ease factor (EF)
 * @returns {Object} Updated { repetitions, interval, easeFactor }
 */
export const calculateSM2 = (quality, repetitions, interval, easeFactor) => {
  let nextRepetitions = 0;
  let nextInterval = 1;
  let nextEaseFactor = easeFactor;

  if (quality >= 3) {
    if (repetitions === 0) {
      nextInterval = 1;
    } else if (repetitions === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(interval * easeFactor);
    }
    nextRepetitions = repetitions + 1;
  } else {
    nextRepetitions = 0;
    nextInterval = 1;
  }

  // Adjust Ease Factor (EF)
  nextEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (nextEaseFactor < 1.3) {
    nextEaseFactor = 1.3;
  }

  return {
    repetitions: nextRepetitions,
    interval: nextInterval,
    easeFactor: parseFloat(nextEaseFactor.toFixed(3))
  };
};

/**
 * Records a performance score/feedback review for a concept and updates its schedule.
 *
 * @param {string} userId
 * @param {string} documentId
 * @param {string} conceptName
 * @param {number} quality - Score rating from 0 to 5
 * @returns {Promise<Object>} The saved MasteryConcept document
 */
export const recordConceptReview = async (userId, documentId, conceptName, quality) => {
  // Find or create concept record
  let concept = await MasteryConcept.findOne({ userId, documentId, conceptName });
  if (!concept) {
    concept = new MasteryConcept({
      userId,
      documentId,
      conceptName
    });
  }

  // Calculate updated SM-2 parameters
  const nextSM2 = calculateSM2(
    quality,
    concept.repetitions,
    concept.interval,
    concept.easeFactor
  );

  // Map Leitner Box (1-5) and overall Mastery Score percentage (20%-100%)
  // If consecutive repetitions is 0 (failed review), fall back to box 1 (20% mastery)
  const box = Math.min(5, Math.max(1, nextSM2.repetitions));
  const masteryScore = Math.round((box / 5) * 100);

  const now = new Date();
  const nextReviewDate = new Date(now.getTime() + nextSM2.interval * 24 * 60 * 60 * 1000);

  // Log history
  concept.history.push({
    reviewedAt: now,
    quality,
    interval: concept.interval,
    easeFactor: concept.easeFactor
  });

  // Assign updated fields
  concept.repetitions = nextSM2.repetitions;
  concept.interval = nextSM2.interval;
  concept.easeFactor = nextSM2.easeFactor;
  concept.box = box;
  concept.masteryScore = masteryScore;
  concept.nextReviewDate = nextReviewDate;

  await concept.save();
  return concept;
};

/**
 * Retrieves all concepts for a user (and optionally document) that are due for review.
 *
 * @param {string} userId
 * @param {string} [documentId] - Optional document ID filter
 * @returns {Promise<Array>} Due concepts sorted by oldest review date first
 */
export const getDueConcepts = async (userId, documentId = null) => {
  const query = {
    userId,
    nextReviewDate: { $lte: new Date() }
  };
  if (documentId) {
    query.documentId = documentId;
  }
  return MasteryConcept.find(query).sort({ nextReviewDate: 1 });
};

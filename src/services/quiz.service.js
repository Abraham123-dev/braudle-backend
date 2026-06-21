import crypto from 'crypto';
import * as AIService from './ai.service.js';
import * as Cache from '../utils/cache.js';
import { buildQuizPrompt, buildCustomAssessmentPrompt } from '../utils/promptBuilder.js';
import { AppError } from '../utils/AppError.js';
import Document from '../models/Document.model.js';
import { GROQ_MODELS } from '../config/models.js';

/**
 * Generates a quiz from document chunks, using cache to save tokens.
 * @param {string} documentId
 * @param {Object} profile - Student profile for level-based questions
 * @param {number} count - Question count
 * @param {string[]} documentTopics - Known topics for strict topic-mapping in the prompt
 */
export const generateQuiz = async (documentId, profile, count = 5, documentTopics = []) => {
  // 1. Generate a versioned cache key
  const cacheKey = Cache.CACHE_KEYS.QUIZ_GENERATED(documentId, profile.level, count);

  // 2. Wrap quiz generation in getOrSet for coalesced, cached retrieval
  return await Cache.getOrSet(
    cacheKey,
    async () => {
      const document = await Document.findById(documentId);
      if (!document || !document.chunks || document.chunks.length === 0) {
        throw new AppError('Document content not ready for quiz generation', 400);
      }

      // Pass documentTopics so the prompt enforces strict topic-mapping
      const prompt = buildQuizPrompt(document.chunks, profile, count, documentTopics);
      const messages = [{ role: 'system', content: prompt }];
      const response = await AIService.callGroqWithRetry(messages, GROQ_MODELS.smart);

      try {
        const cleanJson = response.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanJson);
      } catch (err) {
        console.error('[QUIZ] Generation/Parse error:', err.message);
        throw new AppError('Failed to generate a valid quiz. Please try again.', 500);
      }
    },
    Cache.CACHE_TTL.QUIZ
  );
};

/**
 * Generates a custom practice exam/quiz with specific parameters
 */
export const generateCustomAssessment = async (documentId, options) => {
  const instructionsHash = options.instructions ? crypto.createHash('md5').update(options.instructions).digest('hex') : 'none';
  const cacheKey = Cache.CACHE_KEYS.QUIZ_CUSTOM(
    documentId,
    options.difficulty,
    options.format,
    `${options.numQuestions}_${instructionsHash}`
  );
  
  return await Cache.getOrSet(
    cacheKey,
    async () => {
      const document = await Document.findById(documentId);
      if (!document || !document.chunks || document.chunks.length === 0) {
        throw new AppError('Document content not ready for quiz generation', 400);
      }

      const prompt = buildCustomAssessmentPrompt(document.chunks, options);
      const response = await AIService.callGroqWithRetry(
        [{ role: 'system', content: prompt }],
        GROQ_MODELS.smart
      );

      try {
        const cleanJson = response.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanJson);
      } catch (err) {
        console.error('[CUSTOM QUIZ] Generation/Parse error:', err.message);
        throw new AppError('Failed to generate a valid custom assessment. Please try again.', 500);
      }
    },
    Cache.CACHE_TTL.QUIZ
  );
};


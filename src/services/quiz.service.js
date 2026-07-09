import crypto from 'crypto';
import * as AIService from './ai.service.js';
import * as Cache from '../utils/cache.js';
import { buildQuizPrompt, buildCustomAssessmentPrompt, buildCriticPrompt } from '../utils/promptBuilder.js';
import { AppError } from '../utils/AppError.js';
import Document from '../models/Document.model.js';
import { GROQ_MODELS } from '../config/models.js';
import { parseAIJson } from '../utils/parseAIJson.js';

/**
 * Generates a quiz from document chunks, using cache to save tokens.
 * @param {string} documentId
 * @param {Object} profile - Student profile for level-based questions
 * @param {number} count - Question count
 * @param {string[]} documentTopics - Known topics for strict topic-mapping in the prompt
 */
export const generateQuiz = async (documentId, profile, count = 5, documentTopics = [], sessionId = '', learningObjectives = [], definitions = []) => {
  // 1. Generate a versioned cache key using sessionId (fallback to documentId if not provided)
  const cacheKey = Cache.CACHE_KEYS.QUIZ_GENERATED(sessionId || documentId, profile.level, count);

  // 2. Wrap quiz generation in getOrSet for coalesced, cached retrieval
  return await Cache.getOrSet(
    cacheKey,
    async () => {
      const document = await Document.findById(documentId);
      if (!document || !document.chunks || document.chunks.length === 0) {
        throw new AppError('Document content not ready for quiz generation', 400);
      }

      // Pass documentTopics so the prompt enforces strict topic-mapping
      const prompt = buildQuizPrompt(document.chunks, profile, count, documentTopics, '', learningObjectives, definitions);
      const messages = [{ role: 'system', content: prompt }];
      const response = await AIService.callGroqWithRetry(messages, GROQ_MODELS.smart);

      let parsed = parseAIJson(response, null);
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        console.error('[QUIZ] Generation error: parsed response is invalid or empty');
        throw new AppError('Failed to generate a valid quiz. Please try again.', 500);
      }

      // Generator-Critic Loop for Advanced student level (Expert difficulty)
      if (profile.level === 'advanced') {
        const criticPrompt = buildCriticPrompt(parsed, document.chunks, 'hard');
        const criticResponse = await AIService.callGroqWithRetry(
          [{ role: 'system', content: criticPrompt }],
          GROQ_MODELS.smart
        );
        const refinedParsed = parseAIJson(criticResponse, null);
        if (refinedParsed && Array.isArray(refinedParsed) && refinedParsed.length > 0) {
          parsed = refinedParsed;
        }
      }

      return parsed;
    },
    Cache.CACHE_TTL.QUIZ
  );
};

/**
 * Generates a custom practice exam/quiz with specific parameters
 */
export const generateCustomAssessment = async (documentId, options, sessionId = '') => {
  const instructionsHash = options.instructions ? crypto.createHash('md5').update(options.instructions).digest('hex') : 'none';
  const cacheKey = Cache.CACHE_KEYS.QUIZ_CUSTOM(
    sessionId || documentId,
    options.difficulty,
    options.format,
    `${options.numQuestions}_${options.isExam ? 'exam' : 'practice'}_${instructionsHash}_${options.conceptFocus || ''}`
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

      let parsed = parseAIJson(response, null);
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        console.error('[CUSTOM QUIZ] Generation error: parsed response is invalid or empty');
        throw new AppError('Failed to generate a valid custom assessment. Please try again.', 500);
      }

      // Generator-Critic Loop for Hard / Expert difficulty levels
      const difficulty = (options.difficulty || 'medium').toLowerCase();
      if (difficulty === 'hard' || difficulty === 'expert') {
        const criticPrompt = buildCriticPrompt(parsed, document.chunks, difficulty);
        const criticResponse = await AIService.callGroqWithRetry(
          [{ role: 'system', content: criticPrompt }],
          GROQ_MODELS.smart
        );
        const refinedParsed = parseAIJson(criticResponse, null);
        if (refinedParsed && Array.isArray(refinedParsed) && refinedParsed.length > 0) {
          parsed = refinedParsed;
        }
      }

      return parsed;
    },
    Cache.CACHE_TTL.QUIZ
  );
};


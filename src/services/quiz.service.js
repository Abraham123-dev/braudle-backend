import * as AIService from './ai.service.js';
import * as Cache from '../utils/cache.js';
import { buildQuizPrompt } from '../utils/promptBuilder.js';
import { AppError } from '../utils/AppError.js';
import Document from '../models/Document.model.js';
import { GROQ_MODELS } from '../config/models.js';

/**
 * Generates a quiz from document chunks, using cache to save tokens.
 * @param {string} documentId 
 * @param {Object} profile - Student profile for level-based questions
 * @param {number} count - Question count
 */
export const generateQuiz = async (documentId, profile, count = 5) => {
  // 1. Generate a stable cache key
  // Quiz content depends on: Document + Student Level + Question Count
  const cacheKey = `quiz:${documentId}:${profile.level}:${count}`;

  // 2. Try to hit cache first
  const cachedQuiz = await Cache.getCached(cacheKey);
  if (cachedQuiz) {
    return cachedQuiz;
  }

  // 3. Fetch document content
  const document = await Document.findById(documentId);
  if (!document || !document.chunks || document.chunks.length === 0) {
    throw new AppError('Document content not ready for quiz generation', 400);
  }

  // 4. Build prompt and call Groq (using the Smart model for deep reasoning)
  const prompt = buildQuizPrompt(document.chunks, profile, count);
  const messages = [{ role: 'system', content: prompt }];

  const response = await AIService.callGroqWithRetry(messages, GROQ_MODELS.smart);

  try {
    // 5. Clean AI response and parse JSON (strips potential markdown backticks)
    const cleanJson = response.replace(/```json|```/g, '').trim();
    const quizData = JSON.parse(cleanJson);

    // 6. Cache the result for 24 hours (86400 seconds)
    await Cache.setCached(cacheKey, quizData, 86400);

    return quizData;
  } catch (err) {
    console.error('[QUIZ] Generation/Parse error:', err.message);
    throw new AppError('Failed to generate a valid quiz. Please try again.', 500);
  }}

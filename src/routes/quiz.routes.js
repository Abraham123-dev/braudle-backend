import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { generateQuizSchema, submitQuizSchema, generateCustomAssessmentSchema } from '../validators/quiz.validator.js';
import { quizLimiter, quizGenerationLimiter } from '../middleware/rateLimit.middleware.js';
import {
  generateQuiz,
  generateCustomAssessment,
  submitQuiz,
  getQuizHistory,
  getQuiz,
} from '../controllers/quiz.controller.js';

const router = Router();

// All quiz routes require authentication
router.use(verifyJWT);

// Get quiz history
router.get('/history', getQuizHistory);

// Generate a new quiz for an active teaching session
router.post('/generate', quizGenerationLimiter, validate(generateQuizSchema), generateQuiz);

// Generate a custom practice quiz/exam
router.post('/custom', quizGenerationLimiter, validate(generateCustomAssessmentSchema), generateCustomAssessment);

// Get a specific quiz
router.get('/:quizId', getQuiz);

// Submit and grade a quiz
router.post('/:quizId/submit', quizLimiter, validate(submitQuizSchema), submitQuiz);

export default router;

import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { generateQuizSchema, submitQuizSchema, generateCustomAssessmentSchema, gradeQuestionSchema } from '../validators/quiz.validator.js';
import { quizLimiter, quizGenerationLimiter } from '../middleware/rateLimit.middleware.js';
import {
  generateQuiz,
  generateCustomAssessment,
  submitQuiz,
  gradeQuestion,
  getQuizHistory,
  getQuiz,
  getSessionQuizzes,
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

// Get quizzes for a specific session
router.get('/session/:sessionId', getSessionQuizzes);

// Get a specific quiz
router.get('/:quizId', getQuiz);

// Submit and grade a quiz
router.post('/:quizId/submit', quizLimiter, validate(submitQuizSchema), submitQuiz);

// Grade a single question in real-time
router.post('/:quizId/grade-question', quizLimiter, validate(gradeQuestionSchema), gradeQuestion);

export default router;

import { z } from 'zod';

export const generateQuizSchema = z
  .object({
    sessionId: z.string().length(24, 'Invalid session ID'),
  })
  .strict();

export const generateCustomAssessmentSchema = z
  .object({
    documentId: z.string().length(24, 'Invalid document ID'),
    sessionId: z.string().length(24, 'Invalid session ID').optional(),
    format: z.enum(['objective', 'subjective', 'theory', 'mixed', 'story-based']),
    difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional().default('medium'),
    numQuestions: z.number().min(1).max(20).optional().default(15),
    isExam: z.boolean().optional().default(false),
    instructions: z.string().max(1000).optional(),
    timeLimit: z.number().min(0).optional().default(0),
    revealStyle: z.enum(['instant', 'end']).optional().default('instant'),
    conceptFocus: z.string().max(200).optional()
  })
  .strict();

export const submitQuizSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().length(24, 'Invalid question ID'),
            answer: z.string().min(1, 'Answer cannot be empty').max(2000, 'Answer is too long'),
          })
          .strict()
      )
      .min(1, 'No answers provided')
      .max(20, 'Too many answers'),
  })
  .strict();

export const gradeQuestionSchema = z
  .object({
    questionId: z.string().length(24, 'Invalid question ID'),
    answer: z.string().min(1, 'Answer cannot be empty').max(2000, 'Answer is too long'),
  })
  .strict();

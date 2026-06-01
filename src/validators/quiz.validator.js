import { z } from 'zod';

export const generateQuizSchema = z
  .object({
    sessionId: z.string().length(24, 'Invalid session ID'),
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

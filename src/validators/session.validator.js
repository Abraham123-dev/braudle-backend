import { z } from 'zod';

export const startSessionSchema = z
  .object({
    documentId: z.string().length(24, 'Invalid document ID'),
    mode: z.enum(['teach', 'quiz', 'breakdown', 'exam']),
    explainLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  })
  .strict();

export const teachMessageSchema = z
  .object({
    userMessage: z.string().min(1, 'Message cannot be empty').max(1000, 'Message too long'),
  })
  .strict();

export const breakdownSchema = z
  .object({
    concept: z.string().min(1, 'Concept is required').max(500, 'Concept is too long'),
  })
  .strict();

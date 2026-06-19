import { z } from 'zod';

/**
 * Validator for starting a new learning session
 */
export const startSessionSchema = z.object({
  documentId: z.string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid document ID format'),
  mode: z.enum(['understand', 'review', 'practice', 'prepare', 'ask', 'flashcards'])
    .default('understand'),
});

/**
 * Validator for sending a message in a session
 */
export const chatSchema = z.object({
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message is too long (max 2000 characters)'),
});

/**
 * Validator for updating session state (accepting mentor suggestions)
 */
export const updateStateSchema = z.object({
  mode: z.enum(['understand', 'review', 'practice', 'prepare', 'ask', 'flashcards'])
    .optional(),
  currentChunkIndex: z.number().min(0).optional(),
  mentorSuggestion: z.string().optional(),
  // Set by frontend when student selects a preparation style from the UI options.
  // The AI will also ask in-chat if this is not set (i.e. still 'mixed').
  preparationStyle: z.enum(['story', 'mcq', 'theory', 'mixed']).optional(),
});
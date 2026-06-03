import { z } from 'zod';

/**
 * Validator for document upload metadata
 */
export const uploadSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title cannot exceed 200 characters'),
  subject: z.string()
    .max(100, 'Subject cannot exceed 100 characters')
    .optional()
    .or(z.literal('')), // Allows empty string if not provided
});
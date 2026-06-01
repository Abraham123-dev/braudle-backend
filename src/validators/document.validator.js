import { z } from 'zod';

// File validation is handled by Multer middleware, not Zod.
export const uploadSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title cannot be empty if provided')
      .max(200, 'Title is too long')
      .optional(),
    subject: z
      .string()
      .trim()
      .min(1, 'Subject cannot be empty if provided')
      .max(100, 'Subject is too long')
      .optional(),
  })
  .strict();

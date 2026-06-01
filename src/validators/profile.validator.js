import { z } from 'zod';

export const onboardingSchema = z
  .object({
    studyLevel: z.enum(['secondary', 'university', 'professional', 'self']),
    subjects: z
      .array(z.string().trim().min(1, 'Subject is required').max(100, 'Subject is too long'))
      .min(1, 'Select at least one subject')
      .max(5, 'Maximum 5 subjects'),
    learningStyle: z.enum(['explain_first', 'test_first', 'mix']),
    goal: z.enum(['pass_exams', 'scholarship', 'understand', 'stay_ahead']),
    level: z.enum(['beginner', 'intermediate', 'advanced']),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    subjects: z
      .array(z.string().trim().min(1, 'Subject is required').max(100, 'Subject is too long'))
      .min(1, 'Select at least one subject')
      .max(5, 'Maximum 5 subjects')
      .optional(),
    learningStyle: z.enum(['explain_first', 'test_first', 'mix']).optional(),
  })
  .strict();

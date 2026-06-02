import { z } from 'zod';

// studyLevel, learningStyle, and goal accept preset values OR any custom string
// (student can type 'other: preparing for WAEC science olympiad' etc.)
// level stays as a strict enum — the AI uses it to decide explanation depth.

export const onboardingSchema = z
  .object({
    studyLevel: z
      .string()
      .trim()
      .min(1, 'Study level is required')
      .max(200, 'Study level is too long'),
    learningStyle: z
      .string()
      .trim()
      .min(1, 'Learning style is required')
      .max(200, 'Learning style is too long'),
    goal: z
      .string()
      .trim()
      .min(1, 'Goal is required')
      .max(200, 'Goal is too long'),
    level: z.enum(['beginner', 'intermediate', 'advanced']),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    learningStyle: z.string().trim().min(1).max(200).optional(),
    goal: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

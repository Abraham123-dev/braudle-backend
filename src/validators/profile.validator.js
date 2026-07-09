import { z } from 'zod';

// studyLevel, learningStyle, and goal accept preset values OR any custom string
// (student can type 'other: preparing for WAEC science olympiad' etc.)
// level stays as a strict enum — the AI uses it to decide explanation depth.

export const onboardingSchema = z
  .object({
    studyLevel: z.string().trim().max(200).optional(),
    learningStyle: z.string().trim().max(200).optional(),
    goal: z.string().trim().max(200).optional(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    dailyStudyTarget: z.number().optional(),
    motivation: z.string().trim().max(200).optional(),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    learningStyle: z.string().trim().min(1).max(200).optional(),
    goal: z.string().trim().min(1).max(200).optional(),
    studyLevel: z.string().trim().min(1).max(200).optional(),
    dailyStudyTarget: z.number().optional(),
    motivation: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

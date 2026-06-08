import { z } from 'zod';

// Logout requires an empty request body.
export const logoutSchema = z.object({}).strict();
export const emptyBodySchema = z.object({}).strict();

export const emailLoginSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const magicLinkSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
});

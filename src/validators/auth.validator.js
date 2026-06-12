import { z } from 'zod';

// Logout requires an empty request body.
export const logoutSchema = z.object({}).strict();
export const emptyBodySchema = z.object({}).strict();

export const emailLoginSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const magicLinkSchema = z.object({
  // raw token = crypto.randomBytes(32).toString('hex') = always exactly 64 hex chars.
  // Reject anything outside this range before we touch Redis.
  token: z.string().length(64, 'Invalid token format'),
});

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
});

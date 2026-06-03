import { z } from 'zod';

// Logout requires an empty request body.
export const logoutSchema = z.object({}).strict();
export const emptyBodySchema = z.object({}).strict();

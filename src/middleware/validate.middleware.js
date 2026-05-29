// Zod validation middleware
// Validates request body against Zod schema

import { AppError } from '../utils/AppError.js';

const validate = (schema) => (req, res, next) => {
  try {
    const validated = schema.parse(req.body);
    req.body = validated;
    next();
  } catch (error) {
    if (error.issues) {
      const messages = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    throw error;
  }
};

export { validate };

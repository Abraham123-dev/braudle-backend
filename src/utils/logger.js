/**
 * Structured logger using pino.
 *
 * In production:  outputs newline-delimited JSON — searchable/filterable in Render logs.
 * In development: outputs human-readable coloured output via pino-pretty (if installed),
 *                 falls back gracefully to JSON if not.
 *
 * Usage:
 *   import { logger } from '../utils/logger.js';
 *   logger.info('Server started');
 *   logger.error({ err, userId }, 'Unhandled error in chatSession');
 *   logger.warn({ documentId }, 'Document stuck in pending — marking failed');
 */

import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.nodeEnv !== 'production';

export const logger = pino({
  level: isDev ? 'debug' : 'info',

  // In development, try to use pino-pretty for readable logs.
  // pino-pretty is a devDependency — if not installed this is a no-op.
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),

  // Redact sensitive values from all log lines regardless of caller
  redact: {
    paths: [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.token',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },

  // Standard fields on every log line
  base: {
    env: env.nodeEnv,
    service: 'braudle-api',
  },
});

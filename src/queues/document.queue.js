import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

// Dedicated connection for BullMQ (no commandTimeout to allow blocking long-polls)
const queueConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/**
 * BullMQ Queue for background document processing (OCR, AI extraction, chunking)
 */
export const documentQueue = new Queue('document-processing', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // Keep the last 10 completed jobs for status checks, then discard
    removeOnComplete: { count: 10 },
    // Keep the last 5 failed jobs for debugging post-mortems
    removeOnFail: { count: 5 },
  },
});
import { Queue } from 'bullmq';
import { redisClient } from '../config/redis.js';

/**
 * BullMQ Queue for background document processing (OCR, AI extraction, chunking)
 */
export const documentQueue = new Queue('document-processing', {
  connection: redisClient,
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
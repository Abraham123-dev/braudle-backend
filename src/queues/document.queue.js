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
    removeOnComplete: true,
  },
});
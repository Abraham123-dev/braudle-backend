import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

// Dedicated connection for BullMQ (no commandTimeout to allow blocking long-polls)
const queueConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 30000,
});

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  // Keep the last 10 completed jobs for status checks, then discard
  removeOnComplete: { count: 10 },
  // Keep the last 5 failed jobs for debugging post-mortems
  removeOnFail: { count: 5 },
};

/**
 * BullMQ Queue for high-priority document text extraction & topic summary
 */
export const extractionQueue = new Queue('document-extraction', {
  connection: queueConnection,
  defaultJobOptions,
});

/**
 * BullMQ Queue for rate-limited document embeddings generation
 */
export const embeddingQueue = new Queue('document-embeddings', {
  connection: queueConnection,
  defaultJobOptions,
});

/**
 * BullMQ Queue for slow, deep background study materials generation
 */
export const cacheQueue = new Queue('document-cache', {
  connection: queueConnection,
  defaultJobOptions,
});

/**
 * BullMQ Queue for background, rolling conversation summaries
 */
export const summaryQueue = new Queue('session-summary', {
  connection: queueConnection,
  defaultJobOptions,
});
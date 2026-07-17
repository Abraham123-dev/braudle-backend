import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';

// Dedicated connection for BullMQ (no commandTimeout to allow blocking long-polls)
const queueConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 30000,
});

/**
 * BullMQ key prefix — scopes all queue Redis keys under {braudle:v5}.
 *
 * WHY THIS EXISTS:
 * BullMQ changes its internal Redis key schema between major versions.
 * Without a prefix, upgrading BullMQ (e.g. v4 → v5) leaves stale keys in Redis
 * that the new version cannot parse, causing "unexpected token" / version-mismatch
 * errors on every worker job. This prefix isolates v5 keys completely.
 *
 * Curly-brace syntax ({braudle:v5}) makes the prefix a Redis Cluster hash tag,
 * ensuring all queue keys for one queue land on the same cluster slot.
 *
 * If you upgrade to BullMQ v6 in future, change this to '{braudle:v6}' and
 * run scripts/flush-queues.js once to drain the old queues gracefully.
 */
export const QUEUE_PREFIX = '{braudle:v5}';

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
  prefix: QUEUE_PREFIX,
  defaultJobOptions,
});

/**
 * BullMQ Queue for rate-limited document embeddings generation
 */
export const embeddingQueue = new Queue('document-embeddings', {
  connection: queueConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions,
});

/**
 * BullMQ Queue for slow, deep background study materials generation
 */
export const cacheQueue = new Queue('document-cache', {
  connection: queueConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions,
});

/**
 * BullMQ Queue for background, rolling conversation summaries
 */
export const summaryQueue = new Queue('session-summary', {
  connection: queueConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions,
});
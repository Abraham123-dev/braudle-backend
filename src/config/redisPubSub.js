/**
 * src/config/redisPubSub.js
 *
 * Shared Redis Pub/Sub client for SSE progress streams.
 *
 * WHY THIS EXISTS:
 * The old approach created a brand-new ioredis connection per SSE client (i.e. per
 * user watching their document upload progress bar). On Redis-managed plans (Render,
 * Upstash, etc.) there is a hard connection limit. With many concurrent uploads the
 * pool would exhaust, causing new connections to fail or existing ones to drop.
 *
 * This module owns exactly ONE subscriber connection shared by ALL active SSE streams.
 * Each channel (doc:progress:[documentId]) maps to a Set of write callbacks — one per client
 * currently watching that document. When the last client leaves a channel, we
 * unsubscribe from Redis so we don't keep unused subscriptions alive.
 */

import Redis from 'ioredis';
import { env } from './env.js';

const pubSubClient = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 30000,
});

pubSubClient.on('error', (err) => {
  // Non-fatal: log and continue. Individual SSE clients will time out gracefully.
  console.error('[REDIS PUBSUB] Subscriber connection error:', err.message);
});

pubSubClient.on('connect', () => {
  console.log('[REDIS PUBSUB] Shared subscriber connected.');
});

// Map: channelName → Set of write functions, one per active SSE client
const channelListeners = new Map();

pubSubClient.on('message', (channel, message) => {
  const listeners = channelListeners.get(channel);
  if (!listeners) return;
  for (const writeFn of listeners) {
    try {
      writeFn(message);
    } catch {
      // Client already disconnected — safe to ignore
    }
  }
});

/**
 * Registers a write callback for a Redis channel.
 * Subscribes to the channel if this is the first listener for it.
 *
 * @param {string} channel - e.g. "doc:progress:<documentId>"
 * @param {(message: string) => void} writeFn - Called with each raw Redis message
 */
export const subscribeToProgress = async (channel, writeFn) => {
  if (!channelListeners.has(channel)) {
    // Subscribe to Redis FIRST. Only add the Map entry after success.
    // If subscribe throws (Redis down, timeout), we don't insert a stale
    // empty Set — the next caller will retry the subscribe properly.
    await pubSubClient.subscribe(channel);
    channelListeners.set(channel, new Set());
  }
  channelListeners.get(channel).add(writeFn);
};

/**
 * Removes a write callback from a channel.
 * Unsubscribes from Redis if no listeners remain for that channel.
 *
 * @param {string} channel
 * @param {(message: string) => void} writeFn - The same reference passed to subscribeToProgress
 */
export const unsubscribeFromProgress = async (channel, writeFn) => {
  const listeners = channelListeners.get(channel);
  if (!listeners) return;

  listeners.delete(writeFn);

  if (listeners.size === 0) {
    channelListeners.delete(channel);
    await pubSubClient.unsubscribe(channel).catch(() => {});
  }
};

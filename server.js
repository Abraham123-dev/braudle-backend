import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { connectDB } from './src/config/db.js';
import { logger } from './src/utils/logger.js';

// Connect to database
await connectDB();

// ── Start background workers BEFORE the HTTP server opens for traffic ──────
// This prevents a race condition where an upload job gets queued to Redis
// before any worker is listening to consume it (critical on Render cold starts).
if (env.nodeEnv === 'production' || process.env.START_WORKER_IN_WEB === 'true') {
  logger.info('Starting background workers...');
  try {
    await import('./src/workers/document.worker.js');
    logger.info('Background workers ready.');
  } catch (workerErr) {
    // Log but do NOT exit — the API is still usable. Worker jobs will re-queue on retry.
    logger.error({ err: workerErr }, 'Failed to start background workers');
  }
}

// ── Startup: clean up documents orphaned by a previous crash ─────────────────
// If the server crashed between Document.create() and extractionQueue.add(), those
// documents are stuck in 'pending' forever. Mark them as failed so users know.
try {
  const { default: Document } = await import('./src/models/Document.model.js');
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const orphaned = await Document.updateMany(
    {
      processingStatus: 'pending',
      createdAt: { $lt: fifteenMinutesAgo },
    },
    {
      $set: { processingStatus: 'failed', processingStage: 'failed' }
    }
  );
  if (orphaned.modifiedCount > 0) {
    logger.warn({ count: orphaned.modifiedCount }, 'Marked orphaned pending documents as failed');
  }
} catch (cleanupErr) {
  logger.error({ err: cleanupErr }, 'Orphan cleanup failed (non-fatal)');
}

// Start server
const server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, `Server running on http://localhost:${env.port}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received — shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle unhandled rejection — log structured then exit so Render restarts the dyno
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection — forcing restart');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — forcing restart');
  process.exit(1);
});

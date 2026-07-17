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

// ── Startup: clean up documents orphaned by crashes or abandoned uploads ───────
//
// Two categories of orphan handled differently:
//
// 1. NO fileHash  — these are pre-presigned or multipart-initiated documents where
//    the user never completed the upload (closed the browser, network error, etc.).
//    They have no file in R2, no content, and no processing job queued.
//    Action: DELETE them outright so they never show in the user's library.
//
// 2. Has fileHash — the file reached R2 but the server crashed between
//    Document.create() and extractionQueue.add(). The file exists but no worker
//    job was queued to process it.
//    Action: Mark as FAILED so the user sees a clear status and can re-upload.
try {
  const { default: Document } = await import('./src/models/Document.model.js');
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  // Category 1: ghost pre-presigned docs — delete them
  const ghostResult = await Document.deleteMany({
    processingStatus: 'pending',
    fileHash: { $exists: false },
    createdAt: { $lt: fifteenMinutesAgo },
  });
  if (ghostResult.deletedCount > 0) {
    logger.warn(
      { count: ghostResult.deletedCount },
      'Deleted ghost pending documents (abandoned presigned uploads — no fileHash)'
    );
  }

  // Category 2: real upload that lost its worker job — mark failed
  const crashedResult = await Document.updateMany(
    {
      processingStatus: 'pending',
      fileHash: { $exists: true, $ne: null, $ne: '' },
      createdAt: { $lt: fifteenMinutesAgo },
    },
    { $set: { processingStatus: 'failed', processingStage: 'failed' } }
  );
  if (crashedResult.modifiedCount > 0) {
    logger.warn(
      { count: crashedResult.modifiedCount },
      'Marked orphaned pending documents as failed (file uploaded, worker job was lost)'
    );
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

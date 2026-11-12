import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { connectDB } from './src/config/db.js';
import { logger } from './src/utils/logger.js';

// Connect to database
await connectDB();

// Workers run as a separate Render Background Worker in production.
// Set START_WORKER_IN_WEB=true only for a deliberately single-process deployment.
let embeddedWorkers = null;
if (process.env.START_WORKER_IN_WEB === 'true') {
  logger.info('Starting background workers...');
  try {
    embeddedWorkers = await import('./src/workers/document.worker.js');
    logger.info('Background workers ready.');
  } catch (workerErr) {
    logger.error({ err: workerErr }, 'Failed to start embedded background workers');
    process.exit(1);
  }
}

// ── Startup: clean up documents orphaned by crashes or abandoned uploads ───────
//
// Abandoned presigned uploads have no fileHash and are safe to remove. Confirmed
// documents are left alone here because they may be waiting in BullMQ while the
// worker is scaling or restarting.
//
// NO fileHash — these are pre-presigned or multipart-initiated documents where
//    the user never completed the upload (closed the browser, network error, etc.).
//    They have no file in R2, no content, and no processing job queued.
//    Action: DELETE them outright so they never show in the user's library.
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

} catch (cleanupErr) {
  logger.error({ err: cleanupErr }, 'Orphan cleanup failed (non-fatal)');
}

// Start server
const server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, `Server running on http://localhost:${env.port}`);
});

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Starting graceful shutdown');

  const forceExit = setTimeout(() => {
    logger.fatal('Graceful shutdown timed out');
    process.exit(1);
  }, 30_000);

  try {
    await new Promise((resolve) => server.close(resolve));

    if (embeddedWorkers?.closeDocumentWorkers) {
      await embeddedWorkers.closeDocumentWorkers();
    }

    await mongoose.connection.close();
    await redisClient.quit();

    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    logger.fatal({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

// Handle unhandled rejection — log structured then exit so Render restarts the dyno
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection — forcing restart');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — forcing restart');
  process.exit(1);
});

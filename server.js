import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { connectDB } from './src/config/db.js';

// Connect to database
await connectDB();

// ── Start background workers BEFORE the HTTP server opens for traffic ──────
// This prevents a race condition where an upload job gets queued to Redis
// before any worker is listening to consume it (critical on Render cold starts).
if (env.nodeEnv === 'production' || process.env.START_WORKER_IN_WEB === 'true') {
  console.log('🤖 [SERVER] Starting background workers...');
  try {
    await import('./src/workers/document.worker.js');
    console.log('✅ [SERVER] Background workers ready.');
  } catch (workerErr) {
    // Log but do NOT exit — the API is still usable. Worker jobs will re-queue on retry.
    console.error('🚨 [SERVER] Failed to start background workers:', workerErr.message);
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
    console.warn(`[SERVER] Marked ${orphaned.modifiedCount} orphaned pending document(s) as failed.`);
  }
} catch (cleanupErr) {
  console.error('[SERVER] Orphan cleanup failed (non-fatal):', cleanupErr.message);
}

// Start server
const server = app.listen(env.port, () => {
  console.log(` Server running on port ${env.port} in ${env.nodeEnv} mode`);
  console.log(` http://localhost:${env.port}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle unhandled rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Trigger Nodemon Restart: Mongoose connection active.


import { app } from './src/app.js';
import { env } from './src/config/env.js';
import { connectDB } from './src/config/db.js';

// Connect to database
await connectDB();

// Start server
const server = app.listen(env.port, async () => {
  console.log(` Server running on port ${env.port} in ${env.nodeEnv} mode`);
  console.log(` http://localhost:${env.port}`);

  // Start background workers inside web process (Render Free tier workaround)
  if (env.nodeEnv === 'production' || process.env.START_WORKER_IN_WEB === 'true') {
    console.log('🤖 [SERVER] Starting background workers inside web process...');
    try {
      await import('./src/workers/document.worker.js');
    } catch (workerErr) {
      console.error('🚨 [SERVER] Failed to start background workers:', workerErr.message);
    }
  }
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

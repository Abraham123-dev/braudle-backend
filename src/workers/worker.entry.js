import { closeDocumentWorkers } from './document.worker.js';
import { mongoose } from '../config/db.js';

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WORKER] Received ${signal}; shutting down gracefully.`);

  const forceExit = setTimeout(() => {
    console.error('[WORKER] Graceful shutdown timed out.');
    process.exit(1);
  }, 30000);

  try {
    await closeDocumentWorkers();
    await mongoose.connection.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[WORKER] Graceful shutdown failed:', error.message);
    process.exit(1);
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { env } from './config/env.js';
import { mongoose } from './config/db.js';
import { redisClient } from './config/redis.js';
import { globalLimiter } from './middleware/rateLimit.middleware.js';


const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true, // Allow cookies
  })
);

app.use(hpp());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());
// Simple sanitizer for request body and params (works with Express v5 getters)
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    sanitizeObject(obj[key]);
  }
}

app.use((req, res, next) => {
  try {
    sanitizeObject(req.body);
    sanitizeObject(req.params);
  } catch (e) {
    // don't block requests on sanitizer errors
    console.warn('Request sanitization failed', e.message);
  }
  next();
});

app.use(globalLimiter); // Apply before routes

app.get('/api/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  const redisStatus = redisClient.status === 'ready' ? 'connected' : redisClient.status || 'disconnected';

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongodb: mongoStatus,
    redis: redisStatus,
  });
});

app.use((err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${err.statusCode || 500} - ${err.message}`);
  if (err.stack) console.error(err.stack);

  if (env.nodeEnv === 'development') {
    return res.status(statusCode).json({
      error: message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Something went wrong' : message,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export { app };


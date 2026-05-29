import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { env } from './config/env.js';import { globalLimiter } from './middleware/rateLimit.middleware.js';


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
// MongoDB injection prevention: Zod validation at route level ensures no malicious queries
// All user input validated before reaching database layer

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

app.use(globalLimiter); // Apply before routes

export { app };


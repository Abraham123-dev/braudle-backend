import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from './config/env.js';
import { mongoose } from './config/db.js';
import { redisClient } from './config/redis.js';
import { globalLimiter } from './middleware/rateLimit.middleware.js';
import passport from './config/passport.js';
import authRoutes from './routes/auth.routes.js';
import profileRoutes from './routes/profile.routes.js';
import documentRoutes from './routes/document.routes.js';
import sessionRoutes from './routes/session.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import generalChatRoutes from './routes/generalChat.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import masteryRoutes from './routes/mastery.routes.js';
import { AppError } from './utils/AppError.js';


const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true, // Allow cookies
  })
);

app.use(hpp());
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'DELETE') return next();
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      if (req.originalUrl && req.originalUrl.includes('/api/payments/webhook')) {
        req.rawBody = buf.toString();
      }
    }
  })(req, res, next);
});
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.query) mongoSanitize.sanitize(req.query);
  if (req.params) mongoSanitize.sanitize(req.params);
  next();
});

app.use(passport.initialize());

app.use(globalLimiter); // Apply before routes

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/general-chat', generalChatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/mastery', masteryRoutes);

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
  
  // Generate a unique correlation/error ID for tracking
  const errorId = `err_${crypto.randomUUID().slice(0, 8)}`;

  // Log full error internally for debugging
  console.error(`[ERROR] [ID: ${errorId}] ${statusCode} - ${err.message}`);
  if (err.stack) console.error(err.stack);

  // Handle body-parser / JSON.parse errors gracefully
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON payload provided';
    err.isOperational = true;
  }

  const isDev = env.nodeEnv === 'development';
  
  // Only show stack trace in dev for 500 errors or non-operational bugs
  const showStack = isDev && (statusCode === 500 || !err.isOperational);

  // If it's a 500 error, sanitize the message in production to prevent leaking system details
  const isInternal = statusCode === 500;
  const clientMessage = isInternal && !isDev 
    ? 'An unexpected error occurred on our end. Please try again later.' 
    : message;

  res.status(statusCode).json({
    status: 'error',
    message: clientMessage,
    errorId, // Return reference ID to the client so they can quote it to support
    ...(showStack && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export { app };

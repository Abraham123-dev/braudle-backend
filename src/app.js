import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
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
import adminRoutes from './routes/admin.routes.js';
import AppErrorLog from './models/AppErrorLog.model.js';
import { AppError } from './utils/AppError.js';


const app = express();

app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
// maxAge: 600 caches the preflight response in the browser for 10 minutes,
// eliminating the OPTIONS round-trip before every cross-origin API call.
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
    maxAge: 600,
  })
);

// ── Gzip / Brotli compression ─────────────────────────────────────────────────
// Compresses all JSON/text responses. Typical savings: 60-80% on large payloads.
// Skipped for SSE streams (Content-Type: text/event-stream) automatically.
app.use(compression({
  // Only compress responses > 1KB — below that, compression overhead isn't worth it
  threshold: 1024,
}));

// ── Structured HTTP request logging ──────────────────────────────────────────
// Logs every request as JSON in production (filterable in Render logs).
// In dev, pino-pretty auto-formats with colours if installed; falls back to JSON.
app.use(pinoHttp({
  logger,
  // Don't log health-check polls — they're noise
  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },
  // Redact sensitive fields from logged request/response bodies
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
  customSuccessMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode} [${err.message}]`,
}));

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
app.use('/api/admin/lighthouse', adminRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
// Reports MongoDB + Redis connectivity so Render can detect partial failures
// (e.g. DB disconnected but HTTP still alive).
app.get('/api/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  const redisStatus = redisClient.status === 'ready' ? 'connected' : redisClient.status || 'disconnected';

  const isHealthy = mongoStatus === 'connected' && redisStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    mongodb: mongoStatus,
    redis: redisStatus,
  });
});

const sanitizeRequestBody = (body) => {
  if (!body) return body;
  const sanitized = { ...body };
  const sensitiveKeys = ['password', 'token', 'braudle_token', 'braudle_admin_token', 'accessToken', 'refreshToken'];
  sensitiveKeys.forEach(key => {
    if (key in sanitized) {
      sanitized[key] = '********';
    }
  });
  return sanitized;
};

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  
  // Generate a unique correlation/error ID for tracking
  const errorId = `err_${crypto.randomUUID().slice(0, 8)}`;

  // Structured error log (goes into pino JSON stream in production)
  logger.error({
    errorId,
    statusCode,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
    err,
  }, `[${errorId}] ${statusCode} - ${err.message}`);

  // Central Error House DB Logger (Non-blocking)
  AppErrorLog.create({
    errorId,
    message,
    stack: err.stack,
    statusCode,
    userId: req.user?.id,
    source: 'api',
    route: req.originalUrl || req.url,
    method: req.method,
    body: sanitizeRequestBody(req.body),
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent']
  }).catch(logErr => logger.warn({ err: logErr }, 'Failed to save error log to MongoDB'));

  // Handle body-parser / JSON.parse errors gracefully
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON payload provided';
    err.isOperational = true;
  }

  const isDev = env.nodeEnv === 'development';
  
  // Only show stack trace in dev for 500 errors or non-operational bugs
  const showStack = isDev && (statusCode === 500 || !err.isOperational);

  // Sanitize 500 message in production to prevent leaking system internals
  const isInternal = statusCode === 500;
  const clientMessage = isInternal && !isDev 
    ? 'An unexpected error occurred on our end. Please try again later.' 
    : message;

  res.status(statusCode).json({
    status: 'error',
    message: clientMessage,
    errorId,
    ...(showStack && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export { app };

# BRAUDLE Backend Setup Complete ✅

This is the backend for BRAUDLE — an AI-powered personal tutor web app. Built with Node.js, Express, JavaScript, MongoDB, and Redis.

## 📁 Project Structure

```
braudle-backend/
├── server.js                 # ⭐ Entry point — starts the server
├── src/
│   ├── app.js              # Express app configuration (no server start here)
│   ├── config/
│   │   ├── env.js          # Environment variable validation
│   │   ├── db.js           # MongoDB connection
│   │   └── redis.js        # Redis connection
│   ├── models/             # Mongoose schemas (one file per collection)
│   ├── services/           # Business logic (isolated, reusable)
│   ├── controllers/        # HTTP request handlers (thin layer only)
│   ├── routes/             # Route definitions (one file per feature)
│   ├── middleware/         # Auth, error handling, validation
│   ├── utils/              # Helper functions and utilities
│   ├── validators/         # Zod validation schemas
│   ├── workers/            # BullMQ background job workers
│   ├── queues/             # BullMQ queue definitions
│   └── types/              # JSDoc type definitions
├── .env.example            # Template for environment variables
├── package.json
└── docs/                   # Project documentation

```

## ⚙️ What's Been Set Up

### 1. **Entry Point & Server Setup**
- **`server.js`** — Starts the Express server and connects to MongoDB + Redis
  - Runs only once at app startup
  - Connects to database before listening
  - Handles graceful shutdown on SIGTERM/SIGINT

### 2. **Configuration Files**

#### **`src/config/env.js`**
- Validates all required environment variables
- Exits app if any are missing
- Exports centralized `env` object used throughout the app
- Keep all secrets here, never hardcode them

#### **`src/config/db.js`**
- Establishes MongoDB connection via Mongoose
- Connection persists for the lifetime of the app
- Logs connection status and errors

#### **`src/config/redis.js`**
- Connects to Redis for:
  - Caching (chunk explanations, quiz questions, etc.)
  - BullMQ background job queue
  - Rate limiting counters
  - Session data
- Retry logic built in for connection resilience

### 3. **Express App Setup** (`src/app.js`)
**Security middleware** (in order):
- `helmet` — HTTP hardening, removes header info, sets security headers
- `cors` — Allow requests from frontend only (configured via env var)
- `hpp` — Prevents HTTP parameter pollution attacks
- `express.json()` — Parse JSON request bodies
- `express.urlencoded()` — Parse form data
- `cookieParser` — Parse httpOnly cookies (especially JWT tokens)
- `mongoSanitize` — Remove NoSQL injection attempts like `{$ne: null}`

**Error handling**:
- Global error handler at the END (catches all thrown errors)
- Logs full errors server-side, sends clean messages to client
- Development mode: full stack trace. Production: generic error message

### 4. **Utility Functions**

#### **`src/utils/AppError.js`**
- Custom error class for expected errors (404, 401, 400, etc.)
- Distinguishes operational errors from bugs
- All controllers/services throw this for expected errors

#### **`src/utils/asyncHandler.js`**
- Wrapper for async route handlers
- Catches Promise rejections and passes to error handler
- Eliminates repetitive try/catch blocks

#### **`src/utils/cache.js`**
- Redis caching helpers: `getCached()`, `setCached()`, `deleteCached()`, `clearCachePattern()`
- Handles JSON serialization automatically
- Built-in error handling (doesn't crash if Redis is down)

### 5. **Middleware** (`src/middleware/`)

#### **`auth.middleware.js`**
- Verifies JWT token from httpOnly cookie
- Attaches decoded user to `req.user`
- Applied to all protected routes

### 6. **Folder Structure** (Empty placeholders created)
- **`src/models/`** — Mongoose schemas (one file per collection)
- **`src/services/`** — Business logic (never call services from routes directly, go through controllers)
- **`src/controllers/`** — HTTP handlers (thin — validation already done by Zod, just call service + respond)
- **`src/routes/`** — Route definitions (one file per feature, routes → controllers → services)
- **`src/validators/`** — Zod validation schemas (validate type, shape, length, allowed values)
- **`src/workers/`** — BullMQ background workers for PDF extraction, image transcription
- **`src/queues/`** — BullMQ queue definitions
- **`src/types/`** — JSDoc type definitions for IDE support

## 🚀 Getting Started

### 1. Set Up Environment Variables
```bash
cp .env.example .env
# Edit .env and fill in all values:
# - MONGODB_URI (MongoDB Atlas connection string)
# - JWT_SECRET (random long string)
# - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL (from Google Cloud Console)
# - GROQ_API_KEY (from console.groq.com)
# - HUGGINGFACE_API_KEY (from huggingface.co)
# - AWS_* (S3 or Cloudflare R2 credentials)
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```
This uses `nodemon` to auto-restart on file changes.

### 4. Production Server
```bash
npm start
```

## 📦 Scripts in package.json
```json
{
  "scripts": {
    "start": "node server.js",      // Production
    "dev": "nodemon server.js"      // Development with auto-reload
  }
}
```

## 🔐 Security Rules Enforced
- All secrets in environment variables only (no hardcoding)
- Every POST/PATCH route will have Zod validation
- JWT stored in httpOnly cookies only (never localStorage, never response body)
- Global rate limiting + per-feature limits via Redis
- MongoDB injection protection via `express-mongo-sanitize`
- HTTP parameter pollution protection via `hpp`
- CORS restricted to frontend URL only

## 🎯 Next Steps (When Building Features)
1. **Create Mongoose model** in `src/models/`
2. **Create Zod validator** in `src/validators/`
3. **Create service** with business logic in `src/services/`
4. **Create controller** to handle requests in `src/controllers/`
5. **Create routes** to define endpoints in `src/routes/`
6. **Mount routes** in `src/app.js`

Each feature follows this flow: **Route → Controller → Service → Model → Database**

## 📝 Coding Principles Applied
- ✅ **Separation of concerns** — Routes define paths, Controllers handle I/O, Services contain logic
- ✅ **Single responsibility** — Each file does one thing well
- ✅ **DRY** — Utils and services are reused, no code duplication
- ✅ **Fail fast** — Validation happens at entry point
- ✅ **Explicit over implicit** — Clear function and variable names, no magic
- ✅ **No over-engineering** — Only what's needed for MVP

Ready to build! 🚀

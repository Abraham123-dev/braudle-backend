# BRAUDLE Backend BUILD PLAN
## Phase 1 MVP Implementation — Layer by Layer

**Author:** Abraham  
**Stack:** Node.js + Express (JavaScript ESM) | MongoDB + Mongoose | Redis + BullMQ | Groq + HuggingFace AI  
**Build Principle:** Complete each layer fully before moving to the next. Test locally at each step. Never skip a layer.

---

# LAYER 1: Foundation & Configuration
## Status: [  ] NOT STARTED

**Goal:** Set up environment validation, database connection, Redis connection, and Express app structure.
**Definition of Done:** `docker-compose up --build` runs with zero errors. Health check endpoint returns all services connected.

### Files to Create or Verify

#### 1.1 `server.js` (Entry Point)
```javascript
import app from './src/app.js';
import { env } from './src/config/env.js';

const PORT = env.port;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
```

#### 1.2 `src/app.js` (Express App)
Verify it includes:
- All security middleware in order: helmet → cors → rate-limit → mongo-sanitize → hpp
- JSON body parser with size limit
- Cookie parser
- CORS configured to allow only FRONTEND_URL
- Global rate limiter (100 requests / 15 minutes)
- Error middleware at the end
- Health check endpoint: `GET /api/health`

#### 1.3 `src/config/env.js` (Already Exists)
**Status:** VERIFY
- Check that all required env vars are listed
- Confirm it validates on startup and exits if vars missing
- Verify export structure matches what other files expect

#### 1.4 `src/config/db.js` (MongoDB Connection)
```javascript
import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  try {
    await mongoose.connect(env.mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB error:', err.message);
});

export default mongoose;
```

#### 1.5 `src/config/redis.js` (Already Exists)
**Status:** REVIEW
- Verify it exports `redisClient`
- Check retry strategy is in place
- Confirm events (connect, error, close) have logging

#### 1.6 `src/middleware/error.middleware.js` (Global Error Handler)
```javascript
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message);

  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}
```

#### 1.7 `src/utils/asyncHandler.js` (Error Wrapper for Async Routes)
```javascript
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

#### 1.8 `.env` (Actual Credentials)
**YOU WILL POPULATE THIS** with real values from:
- MongoDB Atlas
- Google Cloud Console
- Groq Console
- HuggingFace

```
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/braudle
JWT_SECRET=<generate-with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxxxx
AWS_BUCKET_NAME=braudle-uploads-dev
AWS_ACCESS_KEY_ID=optional
AWS_SECRET_ACCESS_KEY=optional
AWS_REGION=us-east-1
FRONTEND_URL=http://localhost:3000
REDIS_URL=redis://redis:6379
```

#### 1.9 `.env.example` (Template for Developers)
Same as above but with placeholder values only. Commit this to git. Never commit `.env`.

### Verification Checklist
- [ ] `npm install` completed with zero errors
- [ ] All dependencies in package.json are installed
- [ ] `.env` file created with all real credentials
- [ ] MongoDB Atlas cluster created and connection string obtained
- [ ] Google OAuth credentials created
- [ ] Groq API key generated
- [ ] HuggingFace API token created
- [ ] Redis is running in Docker
- [ ] `docker-compose up --build` starts without errors
- [ ] `curl http://localhost:5000/api/health` returns `{ "status": "ok", "mongodb": "connected", "redis": "connected" }`

### Next Step
Once LAYER 1 is verified, move to LAYER 2: MongoDB Models

---

# LAYER 2: MongoDB Models & Schema
## Status: [  ] NOT STARTED

**Goal:** Define all six MongoDB collections with Mongoose models.
**Definition of Done:** All models created, no validation errors, database properly structured.

### Models to Create

#### 2.1 `src/models/User.model.js`
- Fields: googleId, name, email, avatar, role, createdAt, updatedAt
- Role enum: 'student' | 'admin' | 'teacher'
- Indexes: googleId (unique)
- Upload counters: pdfUploadCount, imgUploadCount, lastUploadDate

#### 2.2 `src/models/StudentProfile.model.js`
- Fields: userId (ref to User), level, weakTopics, strongTopics, totalSessions, averageScore, learningHistory
- Level enum: 'beginner' | 'intermediate' | 'advanced'
- Learning history: array of {documentId, topic, score, mode, date}

#### 2.3 `src/models/Document.model.js`
- Fields: userId, title, type, fileUrl, rawText, chunks, totalChunks, subject, processingStatus
- Type enum: 'pdf' | 'image' | 'audio' | 'text'
- Status enum: 'pending' | 'processing' | 'ready' | 'failed'

#### 2.4 `src/models/Session.model.js`
- Fields: userId, documentId, mode, status, currentChunkIndex, score, summary, startedAt, completedAt, durationMinutes
- Mode enum: 'teach' | 'quiz' | 'breakdown' | 'exam'
- Status enum: 'active' | 'completed' | 'abandoned'

#### 2.5 `src/models/Conversation.model.js`
- Fields: sessionId, userId, messages (array of {role, content, timestamp, type})
- Role enum: 'user' | 'assistant' | 'system'
- Type enum: 'explanation' | 'question' | 'answer' | 'feedback'

#### 2.6 `src/models/Quiz.model.js`
- Fields: sessionId, documentId, questions (array), totalQuestions, score, submittedAt
- Questions array: {question, type, options, answer, explanation, studentAnswer, isCorrect}
- Type enum: 'mcq' | 'theory' | 'true_false'

### Verification Checklist
- [ ] All six models created and exported
- [ ] Each model has timestamps: true
- [ ] All enums are properly defined
- [ ] All foreign keys use ref and ObjectId
- [ ] No syntax errors when running `node -c src/models/User.model.js`
- [ ] MongoDB can create collections (verify in Atlas dashboard)

### Next Step
Once LAYER 2 is complete, move to LAYER 3: Google OAuth

---

# LAYER 3: Google OAuth & JWT Authentication
## Status: [  ] NOT STARTED

**Goal:** Implement complete Google OAuth flow and JWT token management.
**Definition of Done:** Student can login with Google, JWT stored in httpOnly cookie, protected routes validate token.

### Files to Create

#### 3.1 `src/middleware/auth.middleware.js` (JWT Validation)
- Extract JWT from httpOnly cookie
- Verify signature using JWT_SECRET
- Attach user to req.user
- Return 401 if missing or invalid token

#### 3.2 `src/validators/auth.validator.js` (Zod Schemas)
- Google callback validation
- User creation validation
- Login response validation

#### 3.3 `src/controllers/auth.controller.js` (Auth Logic)
**Routes handled:**
- `GET /api/auth/google` — Redirect to Google OAuth consent screen
- `GET /api/auth/google/callback` — Handle Google redirect, create/match user, issue JWT
- `GET /api/auth/me` — Get current logged-in user (protected)
- `POST /api/auth/logout` — Clear JWT cookie (protected)

#### 3.4 `src/routes/auth.routes.js` (Auth Routes)
- Register all four auth endpoints
- Google routes are PUBLIC (no JWT required)
- /me and /logout are PROTECTED (JWT required)

### Implementation Details

**Passport.js Configuration (src/config/passport.js)**
```javascript
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env.js';
import User from '../models/User.model.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: env.google.clientId,
      clientSecret: env.google.clientSecret,
      callbackURL: env.google.callbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            avatar: profile.photos[0]?.value || null,
            role: 'student',
          });
          // Create StudentProfile for new user
          await StudentProfile.create({ userId: user._id });
        } else {
          // Update avatar on every login
          user.avatar = profile.photos[0]?.value || user.avatar;
          await user.save();
        }
        
        done(null, user);
      } catch (error) {
        done(error);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});
```

**JWT Token Creation (after OAuth success)**
```javascript
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function createJWT(userId) {
  return jwt.sign({ userId }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

// In auth controller, after user is authenticated:
const token = createJWT(user._id);
res.cookie('braudle_token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});
res.json({ user: { id: user._id, name: user.name, email: user.email } });
```

### Verification Checklist
- [ ] Passport.js installed and configured
- [ ] JWT logic working (can create and verify tokens)
- [ ] Can sign in with Google (test with Google test user)
- [ ] JWT stored in httpOnly cookie (verify with browser dev tools)
- [ ] `GET /api/auth/me` returns user when cookie present
- [ ] `GET /api/auth/me` returns 401 when cookie missing
- [ ] Logout clears the cookie

### Next Step
Once LAYER 3 is complete, move to LAYER 4: File Upload & Rate Limiting

---

# LAYER 4: Document Upload & Rate Limiting
## Status: [  ] NOT STARTED

**Goal:** Allow PDF and image uploads with proper rate limiting and Multer configuration.
**Definition of Done:** Can upload PDFs (2/day) and images (5/day), files stored in S3/R2, Document created in MongoDB.

### Files to Create

#### 4.1 `src/middleware/upload.middleware.js` (Multer Configuration)
- Accept PDF and image file types only
- Max file size: 50MB
- Store file to S3/R2 temporarily
- Return S3 URL to controller

#### 4.2 `src/middleware/rateLimit.middleware.js` (Upload Rate Limiting)
- Check if user has already uploaded 2 PDFs today
- Check if user has already uploaded 5 images today
- Reset counters at midnight
- Return 429 Too Many Requests if limit exceeded

#### 4.3 `src/validators/document.validator.js` (Zod Schemas)
- File type validation
- File size validation
- Title validation

#### 4.4 `src/controllers/document.controller.js` (Upload Logic)
**Routes handled:**
- `POST /api/documents/upload` — Upload PDF or image
- `GET /api/documents` — List all documents for user
- `GET /api/documents/:id` — Get single document with chunks
- `DELETE /api/documents/:id` — Delete document and all sessions

#### 4.5 `src/routes/document.routes.js` (Document Routes)
- All routes are PROTECTED (JWT required)
- Upload route uses Multer middleware and rate limit middleware
- All routes use asyncHandler wrapper

### Implementation Details

**Upload Rate Limit Middleware**
```javascript
export const checkUploadLimit = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  const today = new Date().toDateString();
  const isNewDay = user.lastUploadDate?.toDateString() !== today;

  if (isNewDay) {
    user.pdfUploadCount = 0;
    user.imgUploadCount = 0;
  }

  const fileType = req.file.mimetype.includes('pdf') ? 'pdf' : 'image';
  const limit = fileType === 'pdf' ? 2 : 5;
  const count = fileType === 'pdf' ? user.pdfUploadCount : user.imgUploadCount;

  if (count >= limit) {
    return res.status(429).json({
      success: false,
      message: `Upload limit reached: ${limit} ${fileType}(s) per day`,
    });
  }

  next();
};
```

**Upload Controller**
```javascript
export const uploadDocument = asyncHandler(async (req, res) => {
  const { title } = req.body;
  const file = req.file;

  // Validate input
  const validation = DocumentValidator.upload.safeParse({ title, fileType: file.mimetype });
  if (!validation.success) {
    return res.status(400).json({ success: false, errors: validation.error.errors });
  }

  // Create document in MongoDB with status 'pending'
  const document = await Document.create({
    userId: req.user.id,
    title: title || file.originalname,
    type: file.mimetype.includes('pdf') ? 'pdf' : 'image',
    fileUrl: file.location, // S3 URL returned by Multer
    processingStatus: 'pending',
  });

  // Add job to BullMQ queue
  await pdfQueue.add({ documentId: document._id, fileUrl: file.location });

  // Update upload counters
  const fileType = file.mimetype.includes('pdf') ? 'pdf' : 'image';
  const user = await User.findById(req.user.id);
  if (fileType === 'pdf') {
    user.pdfUploadCount += 1;
  } else {
    user.imgUploadCount += 1;
  }
  user.lastUploadDate = new Date();
  await user.save();

  res.status(201).json({
    success: true,
    document: { id: document._id, status: 'pending' },
  });
});
```

### Verification Checklist
- [ ] Multer configured for PDF and image file types
- [ ] File size limit of 50MB enforced
- [ ] S3/R2 SDK configured (AWS_BUCKET_NAME in .env)
- [ ] Files upload successfully and get S3 URL
- [ ] User can upload 2 PDFs, then gets 429 on 3rd
- [ ] User can upload 5 images, then gets 429 on 6th
- [ ] Counter resets at midnight
- [ ] Document created in MongoDB with 'pending' status
- [ ] Zod validation catches invalid inputs

### Next Step
Once LAYER 4 is complete, move to LAYER 5: BullMQ Worker & PDF Processing

---

# LAYER 5: Background Processing (BullMQ & PDF Extraction)
## Status: [  ] NOT STARTED

**Goal:** Extract text from uploaded PDFs/images and chunk them for AI teaching.
**Definition of Done:** Files are processed in background, chunks stored in MongoDB, Document status updated to 'ready'.

### Files to Create

#### 5.1 `src/queues/pdf.queue.js` (Job Queue Definition)
- Define BullMQ queue for PDF processing
- Set queue options (concurrency, retries)

#### 5.2 `src/workers/pdf.worker.js` (Background Worker)
- Listen for jobs in PDF queue
- Extract text from PDF or image
- Chunk the text
- Store chunks in MongoDB
- Update Document status to 'ready'
- Handle errors: set status to 'failed'

#### 5.3 `src/services/ingestion.service.js` (Core Extraction Logic)
**Exports:**
- `extractTextFromPDF(fileUrl)` — Use pdf-parse to extract text
- `extractTextFromImage(fileUrl)` — Use Groq Vision to transcribe handwriting
- `chunkText(text)` — Use semantic chunker

#### 5.4 `src/utils/chunker.js` (Semantic Chunking)
**Strategy:**
- Target chunk size: ~500 tokens (~350-400 words)
- Boundary detection: Split at paragraph breaks first
- Overlap: 50 tokens between consecutive chunks
- Return array of chunks with metadata (index, estimated tokens, topic)

### Implementation Details

**PDF Queue (src/queues/pdf.queue.js)**
```javascript
import { Queue } from 'bullmq';
import { redisClient } from '../config/redis.js';

export const pdfQueue = new Queue('pdf-processing', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
  },
});
```

**PDF Worker (src/workers/pdf.worker.js)**
```javascript
import { Worker } from 'bullmq';
import { redisClient } from '../config/redis.js';
import Document from '../models/Document.model.js';
import { extractTextFromPDF, extractTextFromImage, chunkText } from '../services/ingestion.service.js';

const worker = new Worker('pdf-processing', async (job) => {
  const { documentId, fileUrl } = job.data;

  try {
    // Update status to processing
    await Document.findByIdAndUpdate(documentId, { processingStatus: 'processing' });

    // Get document to determine type
    const doc = await Document.findById(documentId);
    let rawText;

    if (doc.type === 'pdf') {
      rawText = await extractTextFromPDF(fileUrl);
    } else if (doc.type === 'image') {
      rawText = await extractTextFromImage(fileUrl);
    } else {
      throw new Error(`Unknown document type: ${doc.type}`);
    }

    // Chunk the text
    const chunks = chunkText(rawText);

    // Update document with extracted text and chunks
    doc.rawText = rawText;
    doc.chunks = chunks;
    doc.totalChunks = chunks.length;
    doc.processingStatus = 'ready';
    await doc.save();

    return { success: true, totalChunks: chunks.length };
  } catch (error) {
    // Update status to failed
    await Document.findByIdAndUpdate(documentId, { processingStatus: 'failed' });
    throw error;
  }
}, {
  connection: redisClient,
  concurrency: 2, // Process 2 files at a time
});

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed: ${job.data.documentId}`);
});

worker.on('failed', (job, error) => {
  console.error(`❌ Job ${job.id} failed: ${error.message}`);
});
```

**Chunking Logic (src/utils/chunker.js)**
```javascript
// Target ~500 tokens per chunk
// 1 token ≈ 0.75 words, so ~500 tokens = ~375 words
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;

export function chunkText(text) {
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = Math.ceil(para.split(/\s+/).length / 0.75);

    if (currentTokens + paraTokens > TARGET_TOKENS && currentChunk) {
      // Save current chunk
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap
      const overlapText = currentChunk.split(/\s+/).slice(-Math.ceil(OVERLAP_TOKENS * 0.75)).join(' ');
      currentChunk = overlapText + '\n\n' + para;
      currentTokens = Math.ceil(OVERLAP_TOKENS + paraTokens);
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
      currentTokens += paraTokens;
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
```

### Verification Checklist
- [ ] BullMQ installed and queue created
- [ ] Worker process can be started without errors
- [ ] PDF extraction works (test with sample PDF)
- [ ] Image OCR works (test with handwritten note image)
- [ ] Chunks are created with proper overlap
- [ ] Document status changes: pending → processing → ready
- [ ] On error, Document status changes to 'failed'
- [ ] Chunks stored in MongoDB under Document.chunks
- [ ] Worker can handle retries on failure

### Next Step
Once LAYER 5 is complete, move to LAYER 6: AI Services

---

# LAYER 6: AI Services (Groq & HuggingFace)
## Status: [  ] NOT STARTED

**Goal:** Set up Groq and HuggingFace SDK, create service functions for all AI operations.
**Definition of Done:** Can call Groq for teaching, HuggingFace for embeddings, all responses cached in Redis.

### Files to Create

#### 6.1 `src/config/models.js` (Model Constants)
- Define all Groq model strings
- Define all HuggingFace model strings
- Define model routing (which feature uses which model)

#### 6.2 `src/services/ai.service.js` (Groq Service)
**Exports:**
- `streamGroq(messages, model)` — Stream response to frontend via SSE
- `callGroq(messages, model)` — Get full response (for quiz gen, summary)
- `callGroqWithRetry(messages, model)` — Add exponential backoff on 429 errors

#### 6.3 `src/services/huggingface.service.js` (HuggingFace Service)
**Exports:**
- `checkAnswerSimilarity(studentAnswer, correctAnswer)` — Returns 'correct' | 'partial' | 'wrong'
- `classifyStudentAnswer(studentAnswer, correctAnswer)` — Zero-shot classification

#### 6.4 `src/utils/promptBuilder.js` (Prompt Assembly)
**Exports:**
- `buildTeachPrompt(chunk, profile, isBreakdown)` — 5-layer teach prompt
- `buildQuizPrompt(chunks)` — Quiz generation prompt
- `buildCorrectionPrompt(chunk, studentAnswer, correctAnswer)` — Misconception correction prompt

#### 6.5 `src/utils/cache.js` (Redis Caching)
**Exports:**
- `getCached(key)` — Get value from Redis
- `setCached(key, value, ttlSeconds)` — Set value in Redis with TTL

### Implementation Details

**Model Constants (src/config/models.js)**
```javascript
export const GROQ_MODELS = {
  smart:  'llama-3.3-70b-versatile',
  fast:   'llama-3.1-8b-instant',
  vision: 'llama-3.2-11b-vision-preview',
};

export const HF_MODELS = {
  embeddings:     'sentence-transformers/all-MiniLM-L6-v2',
  classification: 'facebook/bart-large-mnli',
};

export const MODEL_ROUTING = {
  // All teaching features use smart model
  teachChunk:            GROQ_MODELS.smart,
  correctMisconception:  GROQ_MODELS.smart,
  generateQuiz:          GROQ_MODELS.smart,
  sessionSummary:        GROQ_MODELS.smart,
  
  // Fast checks
  flagForTutor:          GROQ_MODELS.fast,
  detectConfusion:       GROQ_MODELS.fast,
  
  // Vision
  transcribeHandwriting: GROQ_MODELS.vision,
  
  // HuggingFace
  evaluateMCQ:           HF_MODELS.embeddings,
  evaluateShortAnswer:   HF_MODELS.embeddings,
};
```

**Groq Service (src/services/ai.service.js)**
```javascript
import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { GROQ_MODELS } from '../config/models.js';

const groq = new Groq({ apiKey: env.groq.apiKey });

export async function streamGroq(messages, model = GROQ_MODELS.smart) {
  return groq.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.9,
  });
}

export async function callGroq(messages, model = GROQ_MODELS.smart) {
  const res = await groq.chat.completions.create({
    model,
    messages,
    stream: false,
    temperature: 0.5,
    max_tokens: 2048,
  });
  return res.choices[0].message.content ?? '';
}

export async function callGroqWithRetry(messages, model = GROQ_MODELS.smart, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await callGroq(messages, model);
    } catch (err) {
      if (err.status === 429 && attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Groq rate limit exceeded after retries');
}
```

**HuggingFace Service (src/services/huggingface.service.js)**
```javascript
import { HfInference } from '@huggingface/inference';
import { env } from '../config/env.js';
import { HF_MODELS } from '../config/models.js';

const hf = new HfInference(env.huggingface.apiKey);

const SIMILARITY_THRESHOLD = {
  CORRECT: 0.85,
  PARTIAL: 0.60,
  WRONG: 0.00,
};

export async function checkAnswerSimilarity(studentAnswer, correctAnswer) {
  const result = await hf.sentenceSimilarity({
    model: HF_MODELS.embeddings,
    inputs: {
      source_sentence: correctAnswer,
      sentences: [studentAnswer],
    },
  });

  const score = result[0];
  if (score >= SIMILARITY_THRESHOLD.CORRECT) return 'correct';
  if (score >= SIMILARITY_THRESHOLD.PARTIAL) return 'partial';
  return 'wrong';
}

export async function classifyStudentAnswer(studentAnswer, correctAnswer) {
  const result = await hf.zeroShotClassification({
    model: HF_MODELS.classification,
    inputs: `Student: ${studentAnswer} | Expected: ${correctAnswer}`,
    parameters: {
      candidate_labels: ['correct', 'partially correct', 'incorrect', 'unclear'],
    },
  });
  return result.labels[0];
}
```

**Prompt Builder (src/utils/promptBuilder.js)**
```javascript
export function buildTeachPrompt(chunk, profile, isBreakdown = false) {
  const levelInstructions = {
    beginner: 'Use simple everyday language. Define every technical term. Use real world analogies.',
    intermediate: 'Use standard academic language. Technical terms with brief context.',
    advanced: 'Use precise technical terminology. Assume strong prior knowledge. Go deeper.',
  }[profile.level];

  const breakdownInstruction = isBreakdown
    ? 'The student is confused. Use a DIFFERENT approach than before. Try: simpler analogy, step-by-step logic, real world example.'
    : 'Teach in 3-5 clear points. End with exactly one comprehension question.';

  return `You are BRAUDLE, a patient personal tutor. You teach step by step. You never summarise.
${levelInstructions}

SECTION TO TEACH:
${chunk}

INSTRUCTION: ${breakdownInstruction}

After explaining, wait for the student to answer your question before continuing.`;
}

export function buildQuizPrompt(chunks) {
  return `You are a professional exam question writer. Generate exactly 5 questions based ONLY on the content below.
Mix question types: 60% MCQ, 40% short theory.
Each question must have: question, type, options[], answer, explanation.
Return ONLY valid JSON. No markdown, no preamble.

CONTENT:
${chunks.join('\n\n---\n\n')}

Response format:
[
  { "question": "...", "type": "mcq", "options": ["A", "B", "C", "D"], "answer": "A", "explanation": "..." },
  { "question": "...", "type": "theory", "answer": "...", "explanation": "..." }
]`;
}
```

**Cache Utility (src/utils/cache.js)**
```javascript
import { redisClient } from '../config/redis.js';

export async function getCached(key) {
  const val = await redisClient.get(key);
  return val ? JSON.parse(val) : null;
}

export async function setCached(key, value, ttlSeconds) {
  await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
}

// Cache key patterns
export const CACHE_KEYS = {
  TEACH: (docId, chunkIdx, level) => `teach:${docId}:${chunkIdx}:${level}`,
  QUIZ: (documentId) => `quiz:${documentId}`,
  PROFILE: (userId) => `profile:${userId}`,
  EMBED: (docId, chunkIdx) => `embed:${docId}:${chunkIdx}`,
};
```

### Verification Checklist
- [ ] Groq SDK installed and API key verified
- [ ] HuggingFace SDK installed and token verified
- [ ] Can call Groq and get response (test with simple message)
- [ ] Can call HuggingFace embeddings (test with two similar sentences)
- [ ] Streaming works (Groq returns tokens one by one)
- [ ] Retries work (test with invalid request)
- [ ] Prompt builder creates valid prompts
- [ ] Cache get/set works with Redis
- [ ] Temperature and max_tokens settings are correct

### Next Step
Once LAYER 6 is complete, move to LAYER 7: Learning Sessions

---

# LAYER 7: Learning Sessions (Core MVP Feature)
## Status: [  ] NOT STARTED

**Goal:** Implement the complete learning session flow: teach mode, check questions, answer evaluation, streaming.
**Definition of Done:** Student can start a session, receive AI teaching via SSE stream, answer questions, get evaluated.

### Files to Create

#### 7.1 `src/controllers/session.controller.js` (Session Logic)
**Routes handled:**
- `POST /api/sessions/start` — Create new session, return sessionId
- `POST /api/sessions/:id/chat` — Send message, stream AI response via SSE
- `POST /api/sessions/:id/explain` — Request deeper explanation
- `POST /api/sessions/:id/breakdown` — Break down specific concept
- `GET /api/sessions/:id` — Get session state
- `GET /api/sessions/:id/conversation` — Get full conversation history
- `PATCH /api/sessions/:id/complete` — Mark session done, generate summary

#### 7.2 `src/routes/session.routes.js` (Session Routes)
- All routes are PROTECTED (JWT required)
- POST routes use Zod validation
- All routes use asyncHandler wrapper

#### 7.3 `src/validators/session.validator.js` (Zod Schemas)
- Start session validation
- Chat message validation
- Explain/breakdown validation

### Implementation Details

**Start Session Controller**
```javascript
export const startSession = asyncHandler(async (req, res) => {
  const { documentId, mode } = req.body;

  // Validate input
  const validation = SessionValidator.start.safeParse({ documentId, mode });
  if (!validation.success) {
    return res.status(400).json({ success: false, errors: validation.error.errors });
  }

  // Verify document exists and belongs to user
  const document = await Document.findOne({ _id: documentId, userId: req.user.id });
  if (!document || document.processingStatus !== 'ready') {
    return res.status(400).json({ success: false, message: 'Document not ready for study' });
  }

  // Create session
  const session = await Session.create({
    userId: req.user.id,
    documentId,
    mode,
    status: 'active',
    currentChunkIndex: 0,
    startedAt: new Date(),
  });

  // Create conversation
  const conversation = await Conversation.create({
    sessionId: session._id,
    userId: req.user.id,
    messages: [],
  });

  res.status(201).json({
    success: true,
    session: { id: session._id, currentChunkIndex: 0 },
  });
});
```

**Chat/Teaching Stream Controller**
```javascript
export const chatSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  // Validate
  const validation = SessionValidator.chat.safeParse({ message });
  if (!validation.success) {
    return res.status(400).json({ success: false, errors: validation.error.errors });
  }

  // Get session and document
  const session = await Session.findOne({ _id: sessionId, userId: req.user.id });
  if (!session || session.status !== 'active') {
    return res.status(400).json({ success: false, message: 'Session not active' });
  }

  const document = await Document.findById(session.documentId);
  const chunk = document.chunks[session.currentChunkIndex];

  if (!chunk) {
    return res.status(400).json({ success: false, message: 'All chunks completed' });
  }

  // Get user profile for personalization
  const profile = await StudentProfile.findOne({ userId: req.user.id });

  // Get conversation history
  const conversation = await Conversation.findOne({ sessionId });
  const messages = conversation.messages.slice(-16); // Last 8 exchanges = 16 messages

  // Build prompt and add user message
  const systemPrompt = buildTeachPrompt(chunk, profile, session.mode === 'breakdown');
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // Check cache
  const cacheKey = CACHE_KEYS.TEACH(document._id, session.currentChunkIndex, profile.level);
  const cachedResponse = await getCached(cacheKey);

  // Stream response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullResponse = '';

  try {
    if (cachedResponse && message === 'ready') {
      // Use cached explanation
      fullResponse = cachedResponse;
      res.write(`data: ${JSON.stringify({ token: cachedResponse })}\n\n`);
    } else {
      // Call Groq and stream
      const stream = await streamGroq(fullMessages);

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
          fullResponse += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Save response to conversation and cache
    conversation.messages.push(
      { role: 'user', content: message, timestamp: new Date() },
      { role: 'assistant', content: fullResponse, timestamp: new Date() }
    );
    await conversation.save();

    if (!cachedResponse) {
      await setCached(cacheKey, fullResponse, 86400); // 24 hours
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});
```

### Verification Checklist
- [ ] Session can be created with document and mode
- [ ] Student can send message and receive streaming response
- [ ] SSE streaming works (response appears word-by-word)
- [ ] Conversation history is saved
- [ ] Cache is used (second request for same chunk is instant)
- [ ] 5-layer prompt is constructed correctly
- [ ] Session status is 'active' while teaching
- [ ] Can't access other user's sessions (security check)

### Next Step
Once LAYER 7 is complete, move to LAYER 8: Quiz Generation & Scoring

---

# LAYER 8: Quiz Generation & Scoring
## Status: [  ] NOT STARTED

**Goal:** Generate quiz questions, accept student answers, evaluate using embeddings, calculate scores.
**Definition of Done:** Quiz generated from document, student can answer, gets scored correctly.

### Files to Create

#### 8.1 `src/controllers/quiz.controller.js` (Quiz Logic)
**Routes handled:**
- `POST /api/quiz/generate` — Generate quiz from completed session
- `GET /api/quiz/:sessionId` — Get quiz
- `POST /api/quiz/:id/submit` — Submit answers, calculate score

#### 8.2 `src/routes/quiz.routes.js` (Quiz Routes)
- All routes are PROTECTED (JWT required)
- Submit route uses Zod validation

#### 8.3 `src/validators/quiz.validator.js` (Zod Schemas)
- Quiz generation validation
- Answer submission validation

#### 8.4 `src/services/quiz.service.js` (Quiz Logic Service)
**Exports:**
- `generateQuizQuestions(chunks, documentId)` — Call Groq to generate questions
- `evaluateAnswer(studentAnswer, correctAnswer, questionType)` — Use embeddings or LLM
- `calculateScore(responses)` — Return percentage score

### Implementation Details

**Generate Quiz Controller**
```javascript
export const generateQuiz = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;

  // Get session
  const session = await Session.findOne({ _id: sessionId, userId: req.user.id });
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  // Get document
  const document = await Document.findById(session.documentId);

  // Check cache
  const cacheKey = CACHE_KEYS.QUIZ(document._id);
  let quizData = await getCached(cacheKey);

  if (!quizData) {
    // Generate via Groq
    const prompt = buildQuizPrompt(document.chunks);
    const response = await callGroq([{ role: 'user', content: prompt }]);
    quizData = JSON.parse(response);
    await setCached(cacheKey, quizData, 172800); // 48 hours
  }

  // Create Quiz document
  const quiz = await Quiz.create({
    sessionId,
    documentId: session.documentId,
    questions: quizData.map(q => ({
      ...q,
      studentAnswer: null,
      isCorrect: null,
    })),
    totalQuestions: quizData.length,
  });

  res.status(201).json({
    success: true,
    quiz: {
      id: quiz._id,
      questions: quiz.questions.map(({ question, type, options }) => ({
        question,
        type,
        options,
      })),
    },
  });
});
```

**Submit Quiz Controller**
```javascript
export const submitQuiz = asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const { responses } = req.body; // Array of { questionId, answer }

  // Get quiz
  const quiz = await Quiz.findById(quizId);
  if (!quiz) {
    return res.status(404).json({ success: false, message: 'Quiz not found' });
  }

  // Evaluate each answer
  let correctCount = 0;
  for (let i = 0; i < quiz.questions.length; i++) {
    const question = quiz.questions[i];
    const studentAnswer = responses[i]?.answer || '';

    let isCorrect = false;

    if (question.type === 'mcq') {
      // MCQ: Simple comparison
      isCorrect = studentAnswer === question.answer;
    } else {
      // Theory: Use embeddings
      const similarity = await checkAnswerSimilarity(studentAnswer, question.answer);
      isCorrect = similarity === 'correct';
    }

    question.studentAnswer = studentAnswer;
    question.isCorrect = isCorrect;
    if (isCorrect) correctCount++;
  }

  // Calculate score
  const score = Math.round((correctCount / quiz.questions.length) * 100);
  quiz.score = score;
  quiz.submittedAt = new Date();
  await quiz.save();

  // Update session with score
  const session = await Session.findById(quiz.sessionId);
  session.score = score;
  await session.save();

  res.json({
    success: true,
    score,
    feedback: quiz.questions.map(q => ({
      correct: q.isCorrect,
      explanation: q.explanation,
    })),
  });
});
```

### Verification Checklist
- [ ] Quiz generated from document chunks
- [ ] Quiz cached and reused
- [ ] Can submit answers for all question types
- [ ] MCQ answers evaluated correctly
- [ ] Theory answers evaluated with embeddings (not LLM)
- [ ] Score calculated correctly
- [ ] Feedback includes explanations
- [ ] Session updated with score

### Next Step
Once LAYER 8 is complete, move to LAYER 9: Session Summary & Profile Updates

---

# LAYER 9: Session Summary & Adaptive Learning
## Status: [  ] NOT STARTED

**Goal:** Generate session summary, update StudentProfile weak/strong topics, award XP.
**Definition of Done:** After quiz, student sees summary and profile is updated with new weak/strong topics.

### Files to Create

#### 9.1 `src/controllers/profile.controller.js` (Profile Routes)
**Routes handled:**
- `GET /api/profile` — Get student's full profile
- `GET /api/profile/history` — Get paginated session history
- `GET /api/profile/stats` — Get aggregate stats

#### 9.2 `src/routes/profile.routes.js` (Profile Routes)
- All routes are PROTECTED (JWT required)

#### 9.3 `src/services/profile.service.js` (Profile Update Logic)
**Exports:**
- `updateProfileAfterQuiz(userId, score, topic)` — Update weak/strong topics, level, XP
- `getTopic(documentTitle)` — Extract topic from document

#### 9.4 `src/utils/scoreCalculator.js` (Scoring Logic)
**Exports:**
- `extractTopicsFromQuestion(question)` — Get topics from quiz question
- `updateLevelIfEarned(profile)` — Check if level up

### Implementation Details

**Complete Session Controller**
```javascript
export const completeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await Session.findOne({ _id: sessionId, userId: req.user.id });
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  // Generate summary via Groq
  const document = await Document.findById(session.documentId);
  const quiz = await Quiz.findOne({ sessionId });
  
  const summaryPrompt = `Generate a brief learning summary for a student who studied "${document.title}".
Their quiz score was ${quiz.score}%.
Key topics they mastered: [high-scoring questions]
Topics they struggled with: [low-scoring questions]
Next steps: [suggestion for next study session]

Keep it encouraging and 2-3 sentences.`;

  const summary = await callGroq([{ role: 'user', content: summaryPrompt }]);

  // Update session
  session.status = 'completed';
  session.completedAt = new Date();
  session.durationMinutes = Math.round((session.completedAt - session.startedAt) / 60000);
  session.summary = summary;
  await session.save();

  // Update StudentProfile
  await updateProfileAfterQuiz(req.user.id, quiz.score, document.subject);

  res.json({
    success: true,
    summary,
    score: quiz.score,
    durationMinutes: session.durationMinutes,
  });
});

// In profile.service.js
export async function updateProfileAfterQuiz(userId, score, topic) {
  const profile = await StudentProfile.findOne({ userId });

  // Update weak/strong topics
  if (score < 60 && topic) {
    if (!profile.weakTopics.includes(topic)) {
      profile.weakTopics.push(topic);
    }
    // Remove from strong if present
    profile.strongTopics = profile.strongTopics.filter(t => t !== topic);
  } else if (score >= 85 && topic) {
    if (!profile.strongTopics.includes(topic)) {
      profile.strongTopics.push(topic);
    }
    // Remove from weak if present
    profile.weakTopics = profile.weakTopics.filter(t => t !== topic);
  }

  // Update average score
  profile.totalSessions += 1;
  profile.averageScore = Math.round(
    (profile.averageScore * (profile.totalSessions - 1) + score) / profile.totalSessions
  );

  // Check level up
  if (profile.averageScore >= 80 && profile.totalSessions >= 3) {
    const levels = ['beginner', 'intermediate', 'advanced'];
    const currentIndex = levels.indexOf(profile.level);
    if (currentIndex < levels.length - 1) {
      profile.level = levels[currentIndex + 1];
      console.log(`✅ Student ${userId} leveled up to ${profile.level}`);
    }
  }

  // Add to learning history
  profile.learningHistory.push({
    documentId: null, // Set by quiz
    topic,
    score,
    mode: 'quiz',
    date: new Date(),
  });

  await profile.save();
}
```

### Verification Checklist
- [ ] Session can be marked complete
- [ ] Summary is generated and makes sense
- [ ] StudentProfile updated with weak/strong topics
- [ ] Profile learning history includes new session
- [ ] Level up happens after 3+ sessions with 80% avg
- [ ] Can retrieve updated profile via GET /api/profile
- [ ] Session history is paginated

### Next Step
Once LAYER 9 is complete, move to LAYER 10: Frontend Next.js Scaffolding

---

# LAYER 10: Frontend Scaffolding (Next.js)
## Status: [  ] NOT STARTED

**Goal:** Create Next.js frontend project with basic pages and API client.
**Definition of Done:** Frontend can be run locally, connects to backend, shows login page.

### Files to Create
- Folder: `../braudle-frontend/`
- Created via: `npx create-next-app@latest braudle-frontend --typescript --tailwind --app`

### Folder Structure
```
braudle-frontend/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── auth/callback/page.tsx
│   ├── dashboard/page.tsx
│   ├── session/[id]/page.tsx
│   └── layout.tsx
├── components/
│   ├── tutor/TutorChat.tsx
│   └── upload/UploadZone.tsx
├── lib/
│   └── api.ts
├── .env.local
└── package.json
```

### Key Files

#### 10.1 `lib/api.ts` (API Client)
```typescript
import axios from 'axios';

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
});

export async function loginGoogle(code: string) {
  const res = await API.get('/api/auth/google/callback', { params: { code } });
  return res.data;
}

export async function getMe() {
  const res = await API.get('/api/auth/me');
  return res.data;
}

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await API.post('/api/documents/upload', formData);
  return res.data;
}

export async function startSession(documentId: string, mode: string) {
  const res = await API.post('/api/sessions/start', { documentId, mode });
  return res.data;
}
```

#### 10.2 `app/(auth)/login/page.tsx` (Login Page)
```typescript
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">BRAUDLE</h1>
        <p className="mb-8">Your personal AI tutor</p>
        <Link
          href={`${process.env.NEXT_PUBLIC_API_URL}/api/auth/google`}
          className="bg-blue-600 text-white px-8 py-3 rounded-lg"
        >
          Continue with Google
        </Link>
      </div>
    </div>
  );
}
```

#### 10.3 `.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### Verification Checklist
- [ ] Next.js project created
- [ ] Can run `npm run dev`
- [ ] Login page loads at localhost:3000
- [ ] Can click "Continue with Google"
- [ ] API client can make requests to backend
- [ ] Environment variables configured

---

# FINAL VERIFICATION CHECKLIST

Once all 10 layers are complete, run this final verification:

**LAYER 1: Foundation**
- [ ] `docker-compose up --build` succeeds
- [ ] All containers running (backend, mongo, redis)
- [ ] Health check returns ok

**LAYER 2: Models**
- [ ] All 6 models created
- [ ] No MongoDB errors

**LAYER 3: Auth**
- [ ] Can sign in with Google
- [ ] JWT stored in cookie
- [ ] Protected routes require token

**LAYER 4: Upload**
- [ ] Can upload PDF
- [ ] Can upload image
- [ ] Rate limit works (2 PDFs, 5 images per day)

**LAYER 5: Processing**
- [ ] BullMQ worker processes files
- [ ] Document status changes to ready
- [ ] Chunks created

**LAYER 6: AI**
- [ ] Groq API calls work
- [ ] HuggingFace embeddings work
- [ ] Caching works

**LAYER 7: Sessions**
- [ ] Can start session
- [ ] SSE streaming works
- [ ] Conversation saved

**LAYER 8: Quiz**
- [ ] Quiz generated
- [ ] Answers evaluated
- [ ] Score calculated

**LAYER 9: Profile**
- [ ] Profile updated after quiz
- [ ] Level up works
- [ ] History tracked

**LAYER 10: Frontend**
- [ ] Next.js runs
- [ ] Can login
- [ ] Can connect to backend

---

# END OF BUILD PLAN

**Next Action:** Start with LAYER 1 — Foundation & Configuration

**When You Hit Bugs:**
1. Check which layer is affected
2. Review the implementation details for that layer
3. Verify against the checklist
4. Fix one bug at a time before moving to next layer

**Never skip a layer. Complete each one fully.**

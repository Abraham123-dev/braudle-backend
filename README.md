# BRAUDLE Backend 🚀

BRAUDLE is an AI-powered personal tutor web application that transforms uploaded study materials (PDFs, notes, images) into interactive, adaptive learning experiences. It teaches, questions, evaluates, and personalizes lessons for every student — acting as a 24/7 private tutor that lives inside your notes.

This repository hosts the Node.js / Express backend API, database adapters, Redis caching systems, and the background document ingestion pipeline.

---

## ⚡ Tech Stack & Architecture

* **Runtime & Framework**: Node.js (ES Modules) + Express.js
* **Database**: MongoDB Atlas + Mongoose
* **Caching & Queue**: Redis (ioredis) + BullMQ (For background extraction & processing)
* **File Storage**: Cloudflare R2 (S3-compatible Object Storage) with **Direct-to-Storage presigned PUT & Multipart Uploads**
* **AI Models (Groq Cloud)**:
  * **Groq Smart** (`llama-3.3-70b-versatile`): High-reasoning chat completions, exam evaluation, advanced tutoring, and flashcard generation.
  * **Groq Fast** (`llama-3.1-8b-instant`): High-speed teaching, summary generation, intent classification, active recall check questions, and theory quiz grading.
  * **Groq Vision** (`qwen/qwen3.6-27b`): Handwriting/Image transcription and OCR.
  * *Note: Hugging Face inference has been fully retired in favor of local scoring and high-performance Groq completions.*

### AI Model Routing Configuration
The backend routes specialized tasks to the most efficient model matching the complexity:
* **Groq Smart (`llama-3.3-70b-versatile`)**: `teachChunk`, `correctMisconception`, `generateQuiz`, `flashcards`.
* **Groq Fast (`llama-3.1-8b-instant`)**: `detectConfusion`, `generateCheckQuestion`, `sessionSummary`, `evaluateAnswer`, `classifyIntent`.
* **Groq Vision (`qwen/qwen3.6-27b`)**: `transcribeHandwriting`.

---

## 📁 Project Structure

```text
braudle-backend/
├── server.js                 # ⭐ Entry point — starts server and establishes DB connections
├── src/
│   ├── app.js              # Express app configuration, security middleware, and routes setup
│   ├── config/             # Environment, Database, Redis, and Model configurations
│   ├── controllers/        # HTTP request handlers (auth, documents, sessions, quizzes, dashboard)
│   ├── middleware/         # Auth verification, rate limiting, error handlers, and schemas validation
│   ├── models/             # MongoDB Mongoose schemas (User, StudentProfile, Document, Session, Quiz, etc.)
│   ├── queues/             # BullMQ queue definitions
│   ├── routes/             # REST route definitions
│   ├── services/           # Isolated business logic (AI client, storage helpers, email template)
│   ├── utils/              # Helper functions, custom error classes, caching coalescing wrapper
│   ├── validators/         # Zod schemas for input validation
│   ├── workers/            # BullMQ background workers (Document text & OCR parser worker)
│   └── types/              # JSDoc type definitions
├── docs/                   # Architectural guides and reference documentation
├── api_endpoints_documentation.md # Single source of truth for REST endpoints
└── README.md               # This README
```

---

## 🐳 Docker Architecture & Setup

The project includes Docker files optimized for both local development and production-ready deployments.

### Services Configuration (`docker-compose.yml`)
1. **`backend`**: Node.js app built from the local `Dockerfile`.
   - Exposes port `5000`.
   - Mounts `/app/src` to `./src` for local hot-reloading.
   - Automatically loads environments from `.env` via `env_file`.
   - Depends on `mongo` and `redis` services.
2. **`mongo`**: Official MongoDB image `mongo:7`.
   - Exposes port `27017`.
   - Persists data locally on a named volume `mongo_data`.
3. **`redis`**: High-performance Redis container `redis:7-alpine`.
   - Exposes port `6379`.
   - Persists key data on a named volume `redis_data`.

### Run via Docker Compose
To build and spin up the complete backend stack (API server, MongoDB, and Redis) locally:
```bash
docker-compose up --build
```
*To run in the background (detached mode):*
```bash
docker-compose up -d
```
*To stop the containers and keep data volumes intact:*
```bash
docker-compose down
```

### Production Docker Image Building
The `Dockerfile` is built using a secure multi-stage-like approach with a non-privileged user:
1. Base Image: `node:20-alpine` (lightweight, secure).
2. Sets `ENV NODE_ENV=production`.
3. Installs only production dependencies using `npm ci --only=production` to keep the image slim.
4. Creates a custom, unprivileged user `braudle` to run the server (mitigating container breakout risks).
```bash
docker build -t braudle-backend:latest .
```

---

## 🗄️ Database Collections & Schemas

The application database is built on MongoDB Atlas. Schemas are defined using Mongoose:

### 1. User (`User.model.js`)
Stores user authentication profile data and tracks upload quotas.
* `googleId` (String, unique, sparse index): Unique identifier from Google OAuth.
* `name` (String, required): Display name of the user.
* `email` (String, required, unique, index): Lowercase email address.
* `avatar` (String): URL of the user's profile image.
* `authProvider` (String): `'google'` or `'email'`.
* `role` (String): `'student'` or `'admin'` (defaults to `'student'`).
* `uploadCount` (Object): Subfields `{ pdf: Number, image: Number }` to track daily usage quotas.
* `lastUploadDate` (Date): Tracks the date of the user's last uploaded document for daily quota resets.
* `onboardingComplete` (Boolean): Flag representing whether the user has finished profile configuration.

### 2. StudentProfile (`StudentProfile.model.js`)
Maintains the student's learning history, strengths, weaknesses, and gaming attributes.
* `userId` (ObjectId, ref: 'User', unique, required): Reference to the owner.
* `level` (String): `'beginner'`, `'intermediate'`, or `'advanced'`.
* `studyLevel` (String): Academic grade or level (e.g. "University Year 1").
* `learningStyle` (String): Chosen tutoring delivery method (e.g. `'explain_first'`).
* `goal` (String): Target goal or exam.
* `weakTopics` (Array of Strings): Topics the AI analyst determined the student struggles with.
* `strongTopics` (Array of Strings): Topics the student has demonstrated competence in.
* `recentScores` (Array of Numbers): Last 5 quiz scores for level updates.
* `misconceptionHistory` (Array of Objects): Details of student mistakes, linking to `Session`.
* `xp` (Number): Gamified Experience Points earned by answering questions.
* `streak` & `longestStreak` (Numbers): Active consecutive daily study count.
* `learningHistory` (Array of Objects): Snapshot logs of past session outcomes.

### 3. Document (`Document.model.js`)
Represents uploaded study materials and their AI-extracted semantic details.
* `userId` (ObjectId, ref: 'User', index): Document owner.
* `title` (String, required): User-facing filename or label.
* `subject` (String): Subject category.
* `type` (String): `'pdf'` or `'image'`.
* `fileUrl` (String): Final URL location of the file in Cloudflare R2.
* `fileKey` (String): R2 object identifier key.
* `processingStatus` (String): `'pending'`, `'processing'`, `'ready'`, or `'failed'`.
* `processingStage` (String): Granular stages (`'file_received'`, `'extracting_content'`, `'identifying_concepts'`, `'building_learning_map'`, `'preparing_tutor'`, `'ready'`, `'failed'`).
* `rawText` (String): Whole text extracted from the document.
* `chunks` (Array of Strings): Slide-window text segments optimized for AI tutoring context.
* `topics` (Array of Strings): Primary topics extracted from the document.
* `summary` (String): General summary of the document.
* `misconceptions` (Array of Objects): Unresolved misconceptions attached to this specific material.
* `aiUnderstandingFailed` (Boolean): Set to `true` if AI summary fails, keeping the text chunks functional for chat tutoring.

### 4. Session (`Session.model.js`)
Represents an active or historical study engagement between the tutor and the student.
* `userId` (ObjectId, ref: 'User'): Participant.
* `documentId` (ObjectId, ref: 'Document'): Material being studied.
* `mode` (String): Active learning action (`'understand'`, `'review'`, `'practice'`, `'prepare'`, `'ask'`, `'flashcards'`).
* `status` (String): `'active'`, `'completed'`, or `'abandoned'`.
* `currentChunkIndex` (Number): Index of the chunk currently being focused on.
* `score` (Number): Latest score attained in this session.
* `summary` (String): AI-generated post-session summary.
* `mentorSuggestions` (Array of Strings): Actionable learning directions suggested by the AI tutor.

### 5. Quiz (`Quiz.model.js`)
Maintains quizzes generated for study materials and student submission reviews.
* `sessionId` (ObjectId, ref: 'Session'): Associated study session.
* `documentId` (ObjectId, ref: 'Document'): Material source.
* `questions` (Array of Objects): Array containing:
  - `topic` (String)
  - `question` (String)
  - `type` (`'mcq'`, `'true_false'`, or `'theory'`)
  - `options` (Array of Strings - MCQ only)
  - `answer` (String - hidden until submission)
  - `explanation` (String - hidden until submission)
  - `studentAnswer` (String)
  - `isCorrect` (Boolean)
  - `feedback` (String)
* `totalQuestions` (Number): Length of the quiz.
* `score` (Number): Final score achieved (out of 100).

### 6. Conversation (`Conversation.model.js`)
Saves chat history for restoring the frontend chat user interface.
* `sessionId` (ObjectId, ref: 'Session'): Connected session.
* `userId` (ObjectId, ref: 'User'): Student.
* `messages` (Array of Objects): Array of `{ role: 'user'|'assistant'|'system', content: String, timestamp: Date }`.

### 7. RefreshToken (`RefreshToken.model.js`)
Tracks rotated refresh tokens to securely persist login sessions.
* `userId` (ObjectId, ref: 'User'): Token owner.
* `token` (String, unique): Token value.
* `expiresAt` (Date): Absolute expiration time.
* `revokedAt` (Date): Time token was manually invalidated or rotated out.

---

## 🛠️ Getting Started (Bare Metal Setup)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a local `.env` file (copied from `.env.example`) and supply values for:
* Database (`MONGODB_URI` and `REDIS_URL`)
* Session Encryption (`JWT_SECRET`)
* Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`)
* Cloudflare R2 Credentials (`CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`, etc.)
* Resend Mailer API (`RESEND_API_KEY`)
* Groq API (`GROQ_API_KEY`)

### 3. Run the Backend Stack
You **must** start both the Express REST server and the BullMQ worker in separate terminals:
* **Terminal 1 - REST server (Development mode with nodemon)**:
  ```bash
  npm run dev
  ```
* **Terminal 2 - Ingestion Worker (Processes background tasks)**:
  ```bash
  npm run worker
  ```

---

## 🧠 Key Features & Systems

### 1. Direct-to-Storage R2 Ingestion
To prevent server bottlenecks, BRAUDLE bypasses the backend for file transfers.
* **PUT Uploads**: Standard files (<10MB) request a presigned R2 PUT URL, upload directly, and confirm.
* **Multipart Chunked Uploads**: Large PDFs (>10MB) are split on the client and uploaded in parallel using chunk-specific presigned URLs before being assembled.
* **Rate Limits**: Rate limits (2 PDFs and 5 images per day) are enforced atomically in MongoDB to prevent TOCTOU races.
* **Storage Cleanup**: Deleting a document calls a background hook to delete the resource from R2 and removes the database entries.

### 2. Production-Grade Caching & Resiliency
Redis is leveraged to store active streams, student profiles, generated quizzes, and tutor explanations.
* **Promise Coalescing**: Uses a `getOrSet` wrapper to prevent cache stampedes. Overlapping requests for un-cached keys share a single flight promise.
* **Circuit Breaker**: If Redis connection failures consecutive cross 5, a circuit breaker trips, bypassing Redis cache for 30s to keep HTTP latency low.
* **Key Namespacing**: Keys are versioned with a `v1:` namespace to prevent stale schema crashes on redeploy.
* **Timeout Protection**: `commandTimeout` and `connectTimeout` are set to `5000ms` to avoid startup hangs.

### 3. Adaptive Learning & Goal Realignment
Sessions are anchored to 6 distinct learning modes aligned with the student's level (`beginner`, `intermediate`, `advanced`):
1. `understand` (breaks down complex concepts and details)
2. `review` (summarizes notes and concepts)
3. `practice` (asks active recall questions with feedback)
4. `prepare` (runs simulated mock exams)
5. `ask` (direct Q&A tutor chat)
6. `flashcards` (quick review deck revisions, maximum of 5 cards per session)

### 4. Smart Quiz Evaluation
* **MCQs / True-False**: Graded instantly on the backend for zero token cost, returning friendly, positive feedback.
* **Theory Questions**: Evaluated by Groq Llama 3.1 8B, returning a graded score along with non-generic, student-facing feedback explaining the reasoning behind the grade.

---

## 📄 API & System Documentation

* **Detailed REST Contracts**: Detailed specifications for all 27+ endpoints are available in [api_endpoints_documentation.md](api_endpoints_documentation.md).
* **Upload Ingestion Architectures**: Direct-to-Storage integration contracts are outlined in [docs/upload_system_architecture.md](docs/upload_system_architecture.md).

---

## 🔒 Security & Best Practices

* **JWT Cookies**: Authentication uses `httpOnly` secure cookies (`braudle_token` and `braudle_refresh`) to prevent XSS attacks.
* **Ownership Checks**: Enforced at the route controller level for all document, session, and quiz operations.
* **Rate Limiting**: Rate limits are enforced on critical paths (e.g. Magic Link requests, AI generation, and quiz completions).
* **Sanitization**: All inputs are checked using `zod` validation schemas, and MongoDB parameters are sanitized with `express-mongo-sanitize`.

---

## 🔧 Troubleshooting

### MongoDB Connection Failures
* Ensure MongoDB is running locally or check your `MONGODB_URI` string.
* **IP Whitelisting**: If using MongoDB Atlas, make sure your current external IP is added in the Network Access tab of your Atlas cluster.

### Redis Connection Timed Out
* Ensure Redis is active: `redis-server`.
* If Redis goes offline, the backend circuit breaker will trip, and server will fall back to querying MongoDB directly to preserve uptime.

### Ingestion Worker Hanging in Pending Stage
* The ingestion worker runs as a separate process. Make sure `npm run worker` is active.
* **Mongoose Buffering**: Mongoose buffers commands when disconnected. Adding top-level `await connectDB()` in the worker ensures background tasks do not hang indefinitely waiting for database connection resolution.

---

*Last Updated: June 2026*  
*Version: 1.1.0*  
*License: Proprietary - BRAUDLE*

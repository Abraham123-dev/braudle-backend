# BRAUDLE Backend

AI-powered personal tutor web application. Transforms uploaded study materials into interactive, adaptive learning experiences.

## What is BRAUDLE?

BRAUDLE is an educational platform that:
- Accepts PDF and image uploads of study materials
- Uses AI (Groq) to teach content step-by-step
- Generates quizzes from uploaded documents
- Evaluates student answers intelligently
- Adapts difficulty based on student performance
- Tracks learning progress and weak/strong topics

## Tech Stack

Backend: Node.js + Express.js (JavaScript)
Database: MongoDB + Mongoose
Caching & Queues: Redis + BullMQ
AI Models: Groq (teaching) + Hugging Face (evaluation)
Auth: Google OAuth 2.0 + JWT
File Storage: AWS S3 or Cloudflare R2
Containerization: Docker + Docker Compose

## Project Structure

```
src/
  config/          Environment variables, DB, Redis setup
  models/          MongoDB schemas (User, StudentProfile, Document, etc)
  services/        Business logic (AI, quiz, ingestion, profile management)
  controllers/     HTTP request handlers
  routes/          API endpoint definitions
  middleware/      Authentication, validation, rate limiting, error handling
  utils/           Reusable functions (cache, prompt builder, chunker, scoring)
  workers/         Background job processors (PDF extraction)
  queues/          BullMQ queue definitions
  validators/      Zod schemas for input validation
  types/           JSDoc type definitions
```

## Setup Instructions

### Prerequisites

- Node.js 18+ installed
- MongoDB running locally or Atlas URL
- Redis running locally or cloud Redis URL
- Docker Desktop (optional, for containerization)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/braudle

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_jwt_secret_here_at_least_32_chars

# AI APIs
GROQ_API_KEY=gsk_your_groq_key_here
HUGGINGFACE_API_KEY=hf_your_hugging_face_token_here

# Auth (Google OAuth)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# File Storage
AWS_ACCESS_KEY_ID=your_aws_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_here
AWS_S3_BUCKET=braudle-documents
AWS_REGION=us-east-1

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### 3. Get API Keys

#### Groq API Key
1. Go to https://console.groq.com
2. Sign up or login
3. Create new API key
4. Copy key (starts with gsk_)

#### Hugging Face API Token
1. Go to https://huggingface.co
2. Sign up or login
3. Go to Settings > Access Tokens
4. Create new token (type: read)
5. Copy token (starts with hf_)

#### Google OAuth Credentials
1. Go to https://console.cloud.google.com
2. Create new project
3. Create OAuth 2.0 Client ID (Web Application)
4. Add authorized redirect URIs:
   - http://localhost:3000/api/auth/callback/google
   - http://localhost:5000/api/auth/google/callback
5. Copy Client ID and Client Secret

### 4. Run the Application

Option A: Local development (requires MongoDB and Redis running)
```bash
npm run dev
```

Option B: Docker (includes MongoDB and Redis)
```bash
docker-compose up
```

Server will start on http://localhost:5000
Health check endpoint: GET http://localhost:5000/api/health

## Key Systems Explained

### Authentication
- Google OAuth 2.0 only (no passwords)
- JWT stored in httpOnly cookies (secure, XSS-proof)
- All protected routes require valid JWT

### File Processing Pipeline
1. Student uploads PDF/image (max 50MB)
2. Multer validates file type and size
3. File stored in AWS S3 or Cloudflare R2
4. BullMQ background job created
5. PDF text extracted (pdf-parse library)
6. Text split into chunks (~500 tokens each)
7. Chunks stored in MongoDB Document
8. Student can start learning immediately

### Adaptive Learning
- Tracks student level: beginner, intermediate, advanced
- Records weak and strong topics
- Calculates average quiz score
- Automatically upgrades level when avg score >= 80% over 3+ sessions
- Future lessons adapt based on current level

### AI Teaching Flow
1. Student selects learning mode (Teach, Quiz, Breakdown)
2. Backend builds 5-layer prompt:
   - Role: "You are a kind tutor"
   - Student context: Current level and learning mode
   - Content: Document chunk to teach
   - History: Last 8 exchanges (conversation context)
   - Rules: Specific instructions for the mode
3. Prompt sent to Groq API
4. Response streamed back to student via SSE
5. Conversation history saved in MongoDB

### Answer Evaluation
- Simple answers: Hugging Face embeddings (fast, free)
  - Compare student answer to correct answer
  - Similarity score 0-1
  - Threshold: 0.85 = correct, 0.60-0.85 = partial, <0.60 = wrong
- Complex answers: Groq LLM (when needed)
- Result: 90% cost reduction by avoiding LLM calls

### Rate Limiting
- Global: 100 requests per 15 minutes
- Per-feature: 2 PDF uploads per day, 5 image uploads per day
- Tracked in Redis and MongoDB User.uploadCount

### Caching Strategy
- Document chunks cached in Redis (1 hour expiry)
- Conversation state cached
- Cache invalidation on document updates
- Zero-cache fallback to MongoDB

### Background Processing
- BullMQ workers process heavy tasks asynchronously
- PDF extraction doesn't block HTTP response
- Student gets job ID immediately
- Poll status endpoint for completion
- Results available once processing done

## API Endpoints Overview

### Authentication
- POST /api/auth/google - Google OAuth callback
- POST /api/auth/logout - Logout

### Documents
- GET /api/documents - List user's documents
- POST /api/documents - Upload new document
- GET /api/documents/:id - Get document details
- GET /api/documents/:id/status - Check processing status
- DELETE /api/documents/:id - Delete document

### Teaching
- POST /api/teach/start - Start teaching session
- POST /api/teach/stream - Stream AI response
- POST /api/teach/answer - Student submits answer

### Quiz
- POST /api/quiz/generate - Generate quiz from document
- POST /api/quiz/submit - Submit quiz answers
- GET /api/quiz/results/:sessionId - Get quiz results

### Student Profile
- GET /api/profile - Get student profile
- PATCH /api/profile - Update profile settings
- GET /api/profile/progress - Get learning progress

### Health
- GET /api/health - Health check

## Error Handling

All errors follow a consistent format:
```json
{
  "success": false,
  "error": "Error message here",
  "statusCode": 400
}
```

Status codes:
- 200: Success
- 400: Bad request (validation failed)
- 401: Unauthorized (missing/invalid JWT)
- 403: Forbidden (not allowed)
- 404: Not found
- 429: Too many requests (rate limited)
- 500: Server error

Development mode shows full stack traces. Production mode shows generic messages.

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

### Building for Production
```bash
npm run build
```

### Production Start
```bash
npm start
```

## Database Collections

### User
- googleId (unique)
- name
- email
- avatar
- role (student, admin, teacher)
- uploadCount (tracks daily uploads)
- createdAt, updatedAt

### StudentProfile
- userId (reference to User)
- level (beginner, intermediate, advanced)
- weakTopics (array)
- strongTopics (array)
- totalSessions
- averageScore
- learningHistory (array of session results)
- createdAt

### Document
- userId (owner)
- title
- type (pdf, image, audio, text)
- fileUrl (S3 location)
- rawText (extracted text)
- chunks (array of text segments)
- processingStatus (pending, processing, ready, failed)
- subject (optional)
- createdAt

### Conversation
- userId
- documentId
- messages (array of {role, content})
- sessionId
- createdAt, updatedAt

### Quiz
- userId
- documentId
- questions (array of question objects)
- studentAnswers (array of responses)
- score (0-100)
- createdAt

### Session
- userId
- documentId
- mode (teach, quiz, breakdown)
- startedAt
- endedAt
- score
- topicsLearned
- misconceptionsDetected

## Docker Deployment

The project includes Docker configuration for local development and production.

### Local Development with Docker
```bash
docker-compose up
```

This starts:
- Backend service (port 5000)
- MongoDB service (port 27017)
- Redis service (port 6379)

### Production Deployment
1. Build image: `docker build -t braudle-backend:latest .`
2. Tag for registry: `docker tag braudle-backend:latest your-registry/braudle-backend:latest`
3. Push to registry: `docker push your-registry/braudle-backend:latest`
4. Deploy using docker-compose or Kubernetes

## Security Considerations

- All API keys stored in environment variables, never hardcoded
- JWT tokens in httpOnly cookies only (not localStorage)
- Input validation on all POST/PATCH routes using Zod
- MongoDB injection prevention via express-mongo-sanitize
- Rate limiting on all user-action endpoints
- CORS enabled only for frontend URL
- Helmet middleware for HTTP security headers
- No stack traces exposed in production

## Performance Optimization

- Redis caching for frequently accessed data
- BullMQ for background processing to prevent timeouts
- Hugging Face for cheap answer evaluation (no LLM calls)
- Conversation history trimmed to 8 exchanges
- Document chunks (~500 tokens) optimized for LLM processing
- Connection pooling for MongoDB and Redis

## Troubleshooting

### MongoDB Connection Failed
- Ensure MongoDB is running: `mongod`
- Check MONGODB_URI in .env
- If using MongoDB Atlas, whitelist your IP

### Redis Connection Failed
- Ensure Redis is running: `redis-server`
- Check REDIS_URL in .env
- If using cloud Redis, check connection string

### Groq API Key Invalid
- Verify key starts with `gsk_`
- Check key is not expired
- Regenerate key if needed

### Background Jobs Not Processing
- Check Redis is running
- Verify BullMQ can connect to Redis
- Check worker logs for errors

### File Upload Fails
- Check AWS S3 credentials
- Verify bucket exists and is accessible
- Check file size doesn't exceed 50MB

## Contributing

1. Follow the folder structure conventions
2. Place business logic in services, not controllers
3. Use Zod for input validation
4. Use AppError for expected errors
5. Use asyncHandler for all async routes
6. Write clear commit messages
7. Test locally before pushing

## License

Proprietary - BRAUDLE

## Support

For issues or questions, contact the development team or check documentation in the docs/ folder.

## MVP Scope

Phase 1 includes:
- Google OAuth login
- PDF and image upload
- AI teaching with multiple modes
- Quiz generation and evaluation
- Adaptive level management
- Session tracking and progress

Phase 2 (future):
- Voice tutor
- Collaborative study rooms
- Study pack marketplace
- Advanced analytics dashboard

---

Last Updated: May 2026
Version: 1.0

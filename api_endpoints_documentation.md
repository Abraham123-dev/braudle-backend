# BRAUDLE Backend API Documentation

This document is the **single source of truth** for all **27 REST API endpoints** in the BRAUDLE backend. It is written for frontend developers and reflects the **exact, implemented behaviour** of the server.

**Base URL:** `http://localhost:5000/api`

**Authentication:** All protected routes expect an `httpOnly` JWT cookie (`braudle_token`) sent automatically by the browser. Always set `withCredentials: true` on your Axios/Fetch client.

**Error format:** Every error response follows this shape:
```json
{ "status": "error", "message": "Human-readable reason" }
```

---

## Table of Contents
1. [Authentication (`/api/auth`)](#1-authentication-apiauth)
2. [Onboarding & Profile (`/api/profile`)](#2-onboarding--profile-apiprofile)
3. [The Library (`/api/documents`)](#3-the-library-apidocuments)
4. [Teaching Sessions (`/api/sessions`)](#4-teaching-sessions-apisessions)
5. [Quizzes & Exams (`/api/quiz`)](#5-quizzes--exams-apiquiz)
6. [Dashboard & Practice (`/api/dashboard`)](#6-dashboard--practice-apidashboard)

---

## 1. Authentication (`/api/auth`)

BRAUDLE supports two authentication methods: **Google OAuth** and **Email Magic Link**. There are no passwords.

### Cookie contract
| Cookie | `httpOnly` | `secure` | `sameSite` | Max-Age |
|---|---|---|---|---|
| `braudle_token` | ✅ | prod only | strict/lax | 15 minutes |
| `braudle_refresh` | ✅ | prod only | strict/lax | 7 days |

---

### 1.1 `GET /auth/google`
Redirects the user to the Google OAuth consent screen.
- **Auth Required:** No
- **Frontend Action:** `window.location.href = '/api/auth/google'` or an `<a>` tag.

---

### 1.2 `GET /auth/google/callback`
Google redirects here after the user grants permission. Handled entirely by the backend.
- **Auth Required:** No
- **On success:** Sets `braudle_token` + `braudle_refresh` cookies, then redirects to `FRONTEND_URL` (your dashboard).
- **On failure:** Redirects to `FRONTEND_URL/login`.
- **Note:** Google users have their name imported automatically. The `needsNameUpdate` flag will always be `false` for Google users.

---

### 1.3 `POST /auth/refresh`
Silently refreshes an expired access token using the refresh cookie. Call this in the background whenever any API request returns `401 Unauthorized`.
- **Auth Required:** No (uses `braudle_refresh` cookie)
- **Request Body:** Empty `{}`
- **On success:** Issues new `braudle_token` + rotated `braudle_refresh` cookies.
- **Response:**
```json
{ "message": "Session refreshed" }
```
- **Error:** `401` if refresh token is missing, expired, or has been reused (security detection).

---

### 1.4 `POST /auth/logout`
Clears all session cookies and revokes the refresh token in the database.
- **Auth Required:** No (reads `braudle_refresh` cookie if present)
- **Request Body:** Empty `{}`
- **Response:**
```json
{ "message": "Logged out successfully" }
```

---

### 1.5 `GET /auth/me`
Returns the current logged-in user's data. Use this on app load to check auth status.
- **Auth Required:** Yes (JWT cookie)
- **Response:**
```json
{
  "user": {
    "_id": "...",
    "name": "Daniel Alade",
    "email": "daniel@example.com",
    "avatar": "https://...",
    "role": "student",
    "authProvider": "google",
    "onboardingComplete": false,
    "needsNameUpdate": false
  }
}
```
- **`needsNameUpdate`:** `true` only for email-auth users whose name is still the `"New Student"` placeholder. When `true`, redirect to the name collection screen before onboarding.

---

### 1.6 `POST /auth/email/start`
**Email Magic Link — Step 1.** Generates a secure, single-use token and emails a login link to the user. The response is always generic to prevent email enumeration attacks.
- **Auth Required:** No
- **Rate Limit:** 3 requests per 15 minutes per IP
- **Request Body:**
```json
{ "email": "student@example.com" }
```
- **Validation:** `email` must be a valid email address format.
- **Response (always 200, regardless of whether the email exists):**
```json
{
  "message": "If an account exists with that email, a magic login link has been sent to your inbox."
}
```
- **Token:** Valid for **15 minutes**, single-use. The token is hashed before being stored in Redis — the raw token travels only via email.

---

### 1.7 `POST /auth/email/verify`
**Email Magic Link — Step 2.** Verifies the token from the magic link URL. If valid, creates or finds the user, then issues JWT cookies.
- **Auth Required:** No
- **Request Body:**
```json
{ "token": "the_64_character_hex_token_from_the_email_link" }
```
- **Validation:** `token` must be exactly 64 characters.
- **On success:** Sets `braudle_token` + `braudle_refresh` cookies.
- **Response:**
```json
{
  "user": {
    "_id": "...",
    "name": "New Student",
    "email": "student@example.com",
    "authProvider": "email",
    "onboardingComplete": false,
    "needsNameUpdate": true
  },
  "message": "Logged in successfully"
}
```
- **`needsNameUpdate: true`** signals that this is an email user and the name collection screen must be shown before any other onboarding step.
- **Error:** `401 Invalid or expired login link` if token is wrong, expired, or already used.

---

### 1.8 `PATCH /auth/onboarding/name`
Sets the student's display name during onboarding. Only works while the name is still the `"New Student"` placeholder — this endpoint cannot be reused as a general name-change feature.
- **Auth Required:** Yes (JWT cookie)
- **Request Body:**
```json
{ "name": "Daniel" }
```
- **Validation:** `name` must be 2–50 characters. Cannot be set to `"new student"` (case-insensitive).
- **Response:**
```json
{
  "status": "success",
  "user": { "name": "Daniel", "email": "...", "authProvider": "email", ... },
  "message": "Name updated successfully. Proceeding with onboarding."
}
```
- **Error:** `400 Name has already been set or user not found` if the name was already updated.

---

## 2. Onboarding & Profile (`/api/profile`)

### 2.1 `POST /profile/setup`
Creates the student's learning profile. Must be called once after first login (for both Google and email users), after the name has been collected.
- **Auth Required:** Yes
- **Request Body:**
```json
{
  "level": "beginner",
  "studyLevel": "University Year 1",
  "learningStyle": "explain_first",
  "goal": "Pass JAMB Biology"
}
```
- **Validation:** All four fields are optional but recommended. `level` must be `"beginner"`, `"intermediate"`, or `"advanced"`.
- **Error:** `400 Onboarding already completed` if called a second time.
- **Response:** Returns the created `StudentProfile` object.

---

### 2.2 `GET /profile`
Returns the student's full learning profile. Cached in Redis for 5 minutes.
- **Auth Required:** Yes
- **Response:**
```json
{
  "_id": "...",
  "userId": "...",
  "level": "beginner",
  "studyLevel": "University Year 1",
  "learningStyle": "explain_first",
  "goal": "Pass JAMB Biology",
  "weakTopics": ["Cellular Respiration"],
  "strongTopics": ["Photosynthesis"],
  "recentScores": [72, 85, 91],
  "misconceptionHistory": [
    {
      "topic": "Cellular Respiration",
      "description": "Student confused ATP production with glucose production.",
      "sessionId": "...",
      "occurredAt": "2026-06-12T10:00:00Z"
    }
  ],
  "xp": 245,
  "streak": 3,
  "longestStreak": 5,
  "totalSessions": 7,
  "averageScore": 83,
  "weeklyChallenge": { "description": "...", "target": 3, "progress": 1, "completed": false, "xpReward": 50 }
}
```
- **`recentScores`:** Last 5 quiz scores. Used internally for adaptive level-up calculation. Also useful for frontend trend charts.

---

## 3. The Library (`/api/documents`)

### 3.1 `POST /documents/upload` (Multipart/Form-Data)
Uploads a file to Cloudflare R2 and queues it for background AI processing.
- **Auth Required:** Yes
- **Rate Limits:** 2 PDFs per day · 5 images per day (per user)
- **Max file size:** 50MB
- **Accepted types:** `application/pdf`, `image/jpeg`, `image/png`
- **Form Data:**
  | Field | Required | Description |
  |---|---|---|
  | `file` | Yes | The PDF or image file |
  | `title` | No | Display name (defaults to filename) |
  | `subject` | No | e.g. `"Biology"` |
- **Response `202 Accepted`:**
```json
{
  "documentId": "6849a...",
  "status": "pending",
  "message": "Document received and queued for processing"
}
```
- **Error:** `429 Daily X upload limit reached (N/day)` if the daily limit is hit.

---

### 3.2 `GET /documents`
Fetches all documents for the logged-in user (for the library view). Raw text and chunks are excluded from this response.
- **Auth Required:** Yes
- **Response:** Array of document objects sorted newest first. Each object includes `misconceptions` for the "What You're Missing" section on each PDF card.

---

### 3.3 `GET /documents/:id/status` ⭐ Poll this after upload
Poll every 3–5 seconds after uploading a document. Returns the processing stage for the progress bar. **Stop polling** when `processingStatus` is `"ready"` or `"failed"`.

- **Auth Required:** Yes
- **Response:**
```json
{
  "documentId": "6849a...",
  "processingStatus": "processing",
  "processingStage": "building_learning_map",
  "topics": [],
  "summary": ""
}
```
- **`topics` and `summary`** are populated (non-empty) once `processingStatus === "ready"`.

#### Processing Stages — map these to your progress bar UI

| `processingStage` value | Display Label | Step |
|---|---|---|
| `file_received` | File received | 1 / 6 |
| `extracting_content` | Extracting content | 2 / 6 |
| `identifying_concepts` | Identifying key concepts | 3 / 6 |
| `building_learning_map` | Building learning map | 4 / 6 |
| `preparing_tutor` | Preparing AI tutor | 5 / 6 |
| `ready` | Ready to study! | 6 / 6 |
| `failed` | Processing failed | — |

> **`aiUnderstandingFailed`** — a boolean field that may be `true` on a `"ready"` document if Groq failed to extract topics/summary during processing. The document is still fully usable for teaching; all chunks are intact. Use this flag to hide or grey out the summary card gracefully instead of showing empty strings.

---

### 3.4 `GET /documents/:id`
Fetches a specific document including all chunks (for internal use / session context).
- **Auth Required:** Yes (ownership enforced)
- **Error:** `403 Forbidden` if the document belongs to another user.

---

### 3.5 `DELETE /documents/:id`
Permanently deletes a document and cascades the delete to all its sessions, conversations, and quizzes. Also queues cleanup of the file in Cloudflare R2.
- **Auth Required:** Yes (ownership enforced)
- **Response:**
```json
{ "message": "Document deleted successfully" }
```

---

## 4. Teaching Sessions (`/api/sessions`)

### 4.1 `POST /sessions/start`
Anchors a new study session to a document. Any previous active sessions for the same document are automatically marked `"abandoned"`.
- **Auth Required:** Yes
- **Request Body:**
```json
{ "documentId": "6849a...", "mode": "teach" }
```
- **Valid modes:** `"teach"` `"breakdown"` `"quiz"` `"exam"` `"chat"`
- **Error:** `400 Document is still being processed` if `processingStatus !== "ready"`.
- **Response `201`:**
```json
{
  "status": "success",
  "sessionId": "...",
  "mode": "teach",
  "message": "Session started. You can now begin the chat."
}
```

---

### 4.2 `GET /sessions/:id/welcome` ⭐ Call this immediately after start
Call this right after `POST /sessions/start`. Returns the personalised tutor greeting built from the student's name, the document's AI-extracted topics, summary, and all 6 learning mode options. **Render this as the first message in the chat window.**
- **Auth Required:** Yes

- **Response:**
```json
{
  "status": "success",
  "welcome": {
    "message": "Hi Daniel! 👋\n\nI've finished studying your **Biology Notes** notes.\n\nI found **4 key topics**:\n• Photosynthesis\n• Cell Structure\n• Cellular Respiration\n• Plant Nutrition\n\nThis document covers how plants convert sunlight into energy...\n\nWhat would you like to do next?",
    "topics": ["Photosynthesis", "Cell Structure", "Cellular Respiration", "Plant Nutrition"],
    "summary": "This document covers how plants convert sunlight into energy...",
    "documentTitle": "Biology Notes",
    "learningModes": [
      { "id": "breakdown", "label": "Break It Down", "description": "Simplify difficult concepts with analogies and clear language." },
      { "id": "teach",    "label": "Explain Like I'm New", "description": "Teach from first principles with step-by-step guidance." },
      { "id": "chat",     "label": "Quick Insights", "description": "Get key takeaways and ask specific questions freely." },
      { "id": "quiz",     "label": "Quiz Me", "description": "Generate questions to test your knowledge of this document." },
      { "id": "exam",     "label": "Practice Exam", "description": "Simulate exam conditions with no hints or encouragement." },
      { "id": "ask",      "label": "Ask Anything", "description": "Free-form chat — ask whatever you want about this material." }
    ]
  }
}
```

---

### 4.3 `POST /sessions/:id/chat` (SSE Stream)
The core AI engine. Streams the tutor's response word-by-word using Server-Sent Events.
- **Auth Required:** Yes
- **Rate Limit:** 60 messages per hour per user
- **Required Header:** `Accept: text/event-stream`
- **Request Body:**
```json
{ "message": "What is mitochondria?" }
```
- **Special message `"ready"`:** Send this as the first message to trigger the tutor's opening response for the current chunk. Uses Redis cache to avoid unnecessary AI calls.
- **Stream format:**
```
data: {"token": "The "}
data: {"token": "mitochondria "}
data: {"token": "is..."}
data: [DONE]
```
- **Error mid-stream:**
```
data: {"error": "AI Stream interrupted"}
```
- **Concurrent stream protection:** Only one active stream per user at a time. A second request returns `429 Only one active tutoring stream allowed at a time`.

---

### 4.4 `GET /sessions/:id`
Returns session metadata plus the full conversation `messages` array. Use this to restore the chat UI after a page refresh.
- **Auth Required:** Yes
- **Response:**
```json
{
  "session": { "_id": "...", "mode": "teach", "status": "active", "currentChunkIndex": 2, ... },
  "messages": [
    { "role": "user", "content": "...", "timestamp": "..." },
    { "role": "assistant", "content": "...", "timestamp": "..." }
  ]
}
```

---

### 4.5 `PATCH /sessions/:id/complete`
Marks the session as finished. **Immediately returns** a success response. Then, silently in the background, an AI Analyst reads the entire chat transcript, extracts misconceptions and weak/strong topics, saves them to the Document and StudentProfile, and updates the session summary. This background work cannot break or delay your response.
- **Auth Required:** Yes
- **Request Body:** Empty
- **Response `200`:**
```json
{ "status": "success", "message": "Session marked as completed" }
```
> After this call, the document's `misconceptions` array and the profile's `weakTopics`, `strongTopics`, and `misconceptionHistory` will be updated asynchronously (usually within 5–10 seconds).

---

### 4.6 `PATCH /sessions/:id/state`
Updates the current mode or chunk index mid-session. Use this when the student switches learning modes (e.g., from `teach` to `breakdown`) or when the frontend needs to advance to the next chunk.
- **Auth Required:** Yes
- **Request Body (all fields optional):**
```json
{
  "mode": "breakdown",
  "currentChunkIndex": 3,
  "mentorSuggestion": "Consider reviewing Cellular Respiration next."
}
```
- **Response:**
```json
{ "status": "success", "session": { ...updated session... } }
```
- **Error:** `404 Active session not found` if the session doesn't exist, doesn't belong to the user, or is not `"active"`.

---

## 5. Quizzes & Exams (`/api/quiz`)

### 5.1 `POST /quiz/generate`
Generates a 5-question quiz from the document linked to the given session. Questions are adaptive — difficulty scales with the student's current `level`. Answers are stripped from the response to prevent frontend inspection.
- **Auth Required:** Yes
- **Rate Limit:** 5 quiz generations per day per user
- **Request Body:**
```json
{ "sessionId": "..." }
```
- **Response `201`:**
```json
{
  "status": "success",
  "quiz": {
    "_id": "...",
    "sessionId": "...",
    "documentId": "...",
    "totalQuestions": 5,
    "questions": [
      {
        "_id": "...",
        "question": "What is the primary function of the mitochondria?",
        "type": "mcq",
        "options": ["Produces glucose", "Produces ATP", "Stores DNA", "Filters waste"]
      }
    ]
  }
}
```
> If a quiz already exists for the session and hasn't been submitted yet, the existing quiz is returned (idempotent).

---

### 5.2 `POST /quiz/custom`
Generates a fully customised practice assessment directly from a document. Creates a background session automatically.
- **Auth Required:** Yes
- **Rate Limit:** Shared with `POST /quiz/generate` — 5 per day
- **Request Body:**
```json
{
  "documentId": "...",
  "format": "mixed",
  "difficulty": "hard",
  "numQuestions": 10
}
```
- **`format` options:** `"objective"` (MCQ/true-false only) · `"subjective"` (short theory) · `"theory"` (long-form essays) · `"mixed"` (60% MCQ, 40% theory)
- **`difficulty` options:** `"easy"` · `"medium"` · `"hard"` · `"expert"`
- **Response `201`:** Same shape as `POST /quiz/generate`.

---

### 5.3 `GET /quiz/history`
Returns all completed and pending quizzes for the user, sorted newest first.
- **Auth Required:** Yes
- **Response:**
```json
{
  "status": "success",
  "results": 4,
  "quizzes": [ ...array of quiz objects with document title/subject populated... ]
}
```

---

### 5.4 `GET /quiz/:quizId`
Retrieves a specific quiz. **Answers are stripped** if the quiz has not yet been submitted.
- **Auth Required:** Yes (ownership enforced via session → userId)
- **Response:** Full quiz object. If `score` is `undefined`, answers are hidden.

---

### 5.5 `POST /quiz/:quizId/submit`
Grades the quiz using zero-cost Hugging Face semantic similarity embeddings. Calculates score, awards XP, tracks recent scores for adaptive level-up, and updates the student profile. After submission, the full quiz with correct answers revealed is returned.
- **Auth Required:** Yes (ownership enforced)
- **Request Body:**
```json
{
  "answers": [
    { "questionId": "abc123", "answer": "The mitochondria produces ATP" },
    { "questionId": "def456", "answer": "True" }
  ]
}
```
- **Grading logic:**
  - MCQ / true-false: exact semantic match required (`correct`).
  - Theory: `correct` or `partial` match counts as correct (fair human-like grading).
- **Level-up trigger:** If the student's last 3+ scores average ≥ 80, they advance one level (beginner → intermediate → advanced).
- **Response:**
```json
{
  "status": "success",
  "score": 80,
  "newLevel": "intermediate",
  "quiz": {
    "_id": "...",
    "score": 80,
    "submittedAt": "2026-06-12T...",
    "questions": [
      {
        "question": "...",
        "type": "mcq",
        "options": [...],
        "answer": "Produces ATP",
        "explanation": "Mitochondria are the powerhouse of the cell, generating ATP via oxidative phosphorylation.",
        "studentAnswer": "The mitochondria produces ATP",
        "isCorrect": true,
        "topic": "Cell Biology"
      }
    ]
  }
}
```
- **Error:** `400 Quiz has already been submitted` if called twice on the same quiz.

---

## 6. Dashboard & Practice (`/api/dashboard`)

### 6.1 `GET /dashboard/performance`
Aggregates all completed quizzes to calculate overall average and per-subject breakdown. Cached for 5 minutes.
- **Auth Required:** Yes
- **Response:**
```json
{
  "status": "success",
  "data": {
    "totalQuizzes": 12,
    "averageScore": 88,
    "subjectPerformance": [
      { "subject": "Cell Biology", "averageScore": 92, "quizzesTaken": 8 },
      { "subject": "Macroeconomics", "averageScore": 74, "quizzesTaken": 4 }
    ]
  },
  "fromCache": false
}
```

---

### 6.2 `GET /dashboard/recommendations`
Powers the smart suggestion cards on the Practice UI. Returns up to 3 items each of:
- **Ready to Test:** Recently completed sessions that have no quiz yet.
- **Weak Spots:** Documents with unresolved misconceptions identified during session analysis.
- **Auth Required:** Yes
- **Response:**
```json
{
  "status": "success",
  "data": {
    "readyToTest": [
      {
        "sessionId": "...",
        "documentId": "...",
        "title": "Cell Biology",
        "subject": "Biology",
        "reason": "Based on recently completed modules"
      }
    ],
    "weakSpots": [
      {
        "documentId": "...",
        "title": "Macroeconomics",
        "subject": "Economics",
        "weakTopics": ["Supply and Demand", "Price Elasticity"],
        "reason": "Targeted practice on concepts you struggled with recently"
      }
    ]
  }
}
```

---

## Appendix: Global Behaviours

### Authentication errors
Any protected route returns `401 Unauthorized` when:
- No `braudle_token` cookie is present
- The token is expired or invalid
- The user account no longer exists

**Frontend action:** Silently call `POST /auth/refresh`. If that also returns `401`, redirect to `/login`.

### Rate limit errors
All rate-limited routes return `429 Too Many Requests` with a human-readable message in the `message` field.

### Ownership errors
Any attempt to access another user's resource returns `403 Forbidden: Access denied`.

### Background writes after session complete
After `PATCH /sessions/:id/complete`, these fields update asynchronously (no polling required — just re-fetch when the user navigates back to the library):
- `Document.misconceptions[]`
- `StudentProfile.weakTopics[]`
- `StudentProfile.strongTopics[]`
- `StudentProfile.misconceptionHistory[]`
- `Session.summary`

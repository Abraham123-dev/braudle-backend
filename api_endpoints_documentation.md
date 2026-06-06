# BRAUDLE Backend API Documentation

This document outlines all **24 REST API endpoints** currently available in the BRAUDLE backend. It is designed for frontend developers to understand exactly what to send, what they will receive, and the hidden backend logic powering each feature.

**Base URL:** `http://localhost:5000/api`
**Authentication:** All routes (except `auth/google`) expect an `httpOnly` JWT cookie sent automatically by the browser. Ensure `withCredentials: true` is set on your frontend Axios/Fetch client.

---

## 1. Authentication (`/api/auth`)

### 1.1 `GET /auth/google`
- **Logic:** Redirects the user to the Google OAuth consent screen.
- **Frontend Action:** Use a standard `<a>` tag or `window.location.href` to trigger this.

### 1.2 `GET /auth/google/callback`
- **Logic:** Handled automatically. Sets `accessToken` and `refreshToken` cookies, then redirects to frontend dashboard.

### 1.3 `POST /auth/refresh`
- **Logic:** Uses the `refreshToken` cookie to issue a new `accessToken` cookie. Call this silently in the background when an API request fails with `401 Unauthorized`.

### 1.4 `POST /auth/logout`
- **Logic:** Clears all cookies.

### 1.5 `GET /auth/me`
- **Logic:** Returns the basic user data (Name, Email, Profile Picture).

---

## 2. Onboarding & Profile (`/api/profile`)

### 2.1 `GET /profile`
- **Logic:** Returns the full `StudentProfile` (Level, XP, Streak, Weak Topics).

### 2.2 `POST /profile/setup`
- **Logic:** Creates the initial student profile. Must be called after first login.
- **Request Body:**
  ```json
  {
    "level": "beginner",
    "studyLevel": "University Year 1",
    "learningStyle": "explain_first",
    "goal": "Pass JAMB Biology"
  }
  ```
- **Response:** Returns the created profile object.

---

## 3. The Library (`/api/documents`)

### 3.1 `POST /documents/upload` (Multipart/Form-Data)
- **Logic:** Uploads a file to Cloudflare R2 and queues it for background AI chunking/transcription. Rate limited: 2 PDFs/day or 5 Images/day.
- **Form Data:**
  - `file`: The PDF or image file.
  - `title`: Name of the document.
  - `subject`: e.g., "Biology".
- **Response:** `{ "documentId": "123", "status": "pending" }`

### 3.2 `GET /documents`
- **Logic:** Fetches all documents for the library. **Crucially**, this returns the `misconceptions` array for each document (populated by Layer 10), so the frontend can display a "What You're Missing" section on the PDF card.

### 3.3 `GET /documents/:id/status`
- **Logic:** Poll this endpoint after uploading (every 3-5 seconds). Returns a granular `processingStage` so the frontend can display a 6-step progress bar. Once `processingStatus` equals `"ready"`, also returns the AI-extracted `topics` and `summary`.
- **Response:**
  ```json
  {
    "documentId": "123",
    "processingStatus": "processing",
    "processingStage": "building_learning_map",
    "topics": [],
    "summary": ""
  }
  ```
- **Processing Stages (map to your UI progress bar):**
  | Stage | Display Label |
  |---|---|
  | `file_received` | File received |
  | `extracting_content` | Extracting content |
  | `identifying_concepts` | Identifying key concepts |
  | `building_learning_map` | Building learning map |
  | `preparing_tutor` | Preparing AI tutor |
  | `ready` | Ready |
  | `failed` | Processing failed |

### 3.4 `GET /documents/:id` & `DELETE /documents/:id`
- **Logic:** Fetches a specific document, or permanently deletes it (cascading deletes to all sessions and conversations).

---

## 4. Teaching Sessions (`/api/sessions`)

### 4.1 `POST /sessions/start`
- **Logic:** Anchors a new study session to a document. Cancels any previous active sessions for that document.
- **Request Body:** `{ "documentId": "123", "mode": "teach" }`
- **Response:** Returns `sessionId`.

### 4.2 `POST /sessions/:id/chat` (SSE Stream)
- **Logic:** The core AI engine. Streams text word-by-word. It checks Redis cache first to save costs. If the student answers wrongly, the AI auto-corrects them based on their profile level.
- **Headers Needed:** `Accept: text/event-stream`
- **Request Body:** `{ "message": "What is mitochondria?" }`
- **Response:** Streams chunks `data: {"token": "The "}` -> `data: [DONE]`

### 4.3 `GET /sessions/:id`
- **Logic:** Returns the session metadata and the full `messages` array so the chat UI can be restored if the user refreshes the page.

### 4.4 `GET /sessions/:id/welcome`
- **Logic:** Call this immediately after `POST /sessions/start`. Returns a personalised tutor greeting built from the student's name, the document's AI-extracted `topics`, `summary`, and the list of all 6 learning modes. The frontend renders this as the first message in the chat window.
- **Response:**
  ```json
  {
    "status": "success",
    "welcome": {
      "message": "Hi Daniel! 👋\n\nI've finished studying your Biology notes.\n\nI found 4 key topics:\n• Photosynthesis\n• Cell Structure\n• Cellular Respiration\n• Plant Nutrition\n\nWhat would you like to do next?",
      "topics": ["Photosynthesis", "Cell Structure", "Cellular Respiration", "Plant Nutrition"],
      "summary": "This document explains how plants convert sunlight into energy...",
      "documentTitle": "Biology Notes",
      "learningModes": [
        { "id": "breakdown", "label": "Break It Down", "description": "Simplify difficult concepts..." },
        { "id": "teach", "label": "Explain Like I'm New", "description": "Teach from first principles..." },
        { "id": "chat", "label": "Quick Insights", "description": "Get key takeaways..." },
        { "id": "quiz", "label": "Quiz Me", "description": "Generate questions..." },
        { "id": "exam", "label": "Practice Exam", "description": "Simulate exam conditions..." },
        { "id": "chat", "label": "Ask Anything", "description": "Free-form chat..." }
      ]
    }
  }
  ```

### 4.4 `POST /sessions/:id/complete`
- **Logic:** Marks the session as finished. **Background Magic:** It silently triggers an AI analyst to read the entire chat transcript, extract specific `misconceptions`, save them to the Document in the Library, and update the global profile weak spots.

### 4.5 `PATCH /sessions/:id/state`
- **Logic:** Updates the current `mode` (e.g. from `teach` to `breakdown`) or the `currentChunkIndex`.

---

## 5. Quizzes & Exams (`/api/quiz`)

### 5.1 `POST /quiz/generate`
- **Logic:** Generates a 5-question quiz based on an active session. Rate limited to 5/day.
- **Request Body:** `{ "sessionId": "123" }`
- **Response:** Returns the quiz object. **Answers are stripped** to prevent frontend cheating.

### 5.2 `POST /quiz/custom`
- **Logic:** Generates a highly customized practice exam directly from an uploaded document. It creates a background "ghost session" marked as `mode: exam` if the difficulty is expert.
- **Request Body:**
  ```json
  {
    "documentId": "123",
    "format": "theory",       // "objective", "subjective", "theory", "mixed"
    "difficulty": "expert",   // "easy", "medium", "hard", "expert"
    "numQuestions": 15
  }
  ```

### 5.3 `GET /quiz/:quizId`
- **Logic:** Retrieves a generated quiz. If `score` is undefined, the answers are stripped.

### 5.4 `POST /quiz/:quizId/submit`
- **Logic:** Grades the quiz using zero-cost Hugging Face math embeddings (saves AI API tokens). Calculates a final score, assigns bonus XP, saves recent score history, and automatically levels up the student if applicable.
- **Request Body:**
  ```json
  {
    "answers": [
      { "questionId": "abc", "answer": "Powerhouse of the cell" }
    ]
  }
  ```
- **Response:** 
  ```json
  {
    "status": "success",
    "score": 95,
    "newLevel": "intermediate",
    "quiz": { ...full graded quiz with correct answers revealed... }
  }
  ```

### 5.5 `GET /quiz/history`
- **Logic:** Returns an array of all completed quizzes/exams.

---

## 6. Dashboard & Practice API (`/api/dashboard`)

### 6.1 `GET /dashboard/performance`
- **Logic:** Aggregates all completed quizzes to calculate the overall average, total taken, and builds a breakdown of performance by subject.
- **Response:**
  ```json
  {
    "data": {
      "totalQuizzes": 12,
      "averageScore": 88,
      "subjectPerformance": [
        { "subject": "Cell Biology", "averageScore": 92, "quizzesTaken": 8 },
        { "subject": "Macroeconomics", "averageScore": 74, "quizzesTaken": 4 }
      ]
    }
  }
  ```

### 6.2 `GET /dashboard/recommendations`
- **Logic:** Powers the smart suggestion cards on the Practice UI. Finds recently completed sessions with no quizzes, and scans the Library for unresolved misconceptions to suggest targeted practice.
- **Response:**
  ```json
  {
    "data": {
      "readyToTest": [
        { "documentId": "123", "title": "Cell Biology", "reason": "Based on recently completed modules" }
      ],
      "weakSpots": [
        { "documentId": "456", "title": "Macroeconomics", "weakTopics": ["Supply and Demand"], "reason": "Targeted practice on concepts you struggled with" }
      ]
    }
  }
  ```

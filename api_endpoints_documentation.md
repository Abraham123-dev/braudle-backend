# BRAUDLE API Endpoint Documentation

**Base URL:** `http://localhost:5000`

This document details all currently implemented API endpoints, starting from Authentication (Layer 3) to Onboarding (Layer 5). 

---

## 🔒 1. Authentication Endpoints (`/api/auth`)

All auth endpoints handle sessions via secure HTTP-Only cookies. The backend manages two cookies:
* `braudle_token`: Short-lived Access Token (JWT, expires in 15 minutes).
* `braudle_refresh`: Long-lived Refresh Token (stored in database, expires in 7 days).

### 1.1 Initiate Google OAuth
* **Endpoint:** `GET /api/auth/google`
* **Auth Required:** No
* **Description:** Redirects the user to the Google OAuth 2.0 consent screen to log in or register.
* **Frontend Responsibility:** 
  - Place a button labeled "Continue with Google".
  - Redirect the browser directly to this endpoint: `window.location.href = 'http://localhost:5000/api/auth/google';`

---

### 1.2 Google OAuth Callback
* **Endpoint:** `GET /api/auth/google/callback`
* **Auth Required:** No
* **Description:** Handled by Google after authorization. Matches returning users or creates a new `User` document. Issues the `braudle_token` and `braudle_refresh` cookies, then redirects the client to the frontend dashboard or onboarding page.
* **Response Status Codes:**
  - `302 Found`: Redirects to `${FRONTEND_URL}/dashboard` (if onboarding is complete) or `${FRONTEND_URL}/onboarding` (if onboarding is not complete).
  - `401 Unauthorized` / `409 Conflict`: If authentication fails or email is already linked.

---

### 1.3 Get Current User Profile
* **Endpoint:** `GET /api/auth/me`
* **Auth Required:** Yes (`braudle_token` cookie must be present)
* **Description:** Fetches the logged-in user's essential identity details.
* **Response Status Codes:**
  - `200 OK`: Success.
  - `401 Unauthorized`: Token missing, expired, or invalid.
  - `404 Not Found`: User no longer exists in the database.
* **Response Example (`200 OK`):**
  ```json
  {
    "user": {
      "_id": "60d5ec493d8b2d2f78c8577a",
      "name": "Jide Abraham",
      "email": "jide@example.com",
      "avatar": "https://lh3.googleusercontent.com/a/ALm5wu0...",
      "role": "student",
      "onboardingComplete": false
    }
  }
  ```
* **Frontend Validation & Actions:**
  - Call this endpoint on application startup / page refresh to populate the global state (e.g., Zustand/Redux).
  - If `onboardingComplete` is `false`, redirect the user to `/onboarding`.
  - If `401 Unauthorized` is returned, clear local state and redirect to `/login`.

---

### 1.4 Refresh Access Token
* **Endpoint:** `POST /api/auth/refresh`
* **Auth Required:** Yes (`braudle_refresh` cookie must be present)
* **Description:** Invalidates the current refresh token, rotates it, and issues new Access and Refresh tokens inside HTTP-Only cookies.
* **Response Status Codes:**
  - `200 OK`: Session refreshed successfully.
  - `401 Unauthorized`: Refresh token missing, expired, or revoked.
* **Response Example (`200 OK`):**
  ```json
  {
    "message": "Session refreshed"
  }
  ```
* **Frontend Actions:**
  - Set up an interceptor in your HTTP client (e.g., Axios instance).
  - If a request returns `401` due to an expired access token, intercept it, call `POST /api/auth/refresh`, and then retry the original request.

---

### 1.5 Logout
* **Endpoint:** `POST /api/auth/logout`
* **Auth Required:** No (But cookie should be present to revoke it on server)
* **Description:** Revokes the active refresh token in the database and clears all auth cookies.
* **Response Status Codes:**
  - `200 OK`: Logged out successfully.
* **Response Example (`200 OK`):**
  ```json
  {
    "message": "Logged out successfully"
  }
  ```
* **Frontend Actions:**
  - Call this endpoint when the user clicks the "Logout" button.
  - Clear the local client state and redirect the user back to `/login`.

---

## 🎓 2. Profile & Onboarding Endpoints (`/api/profile`)

Onboarding collects basic educational and behavioral data from the student to calibrate the adaptive AI system.

### 2.1 Complete Onboarding
* **Endpoint:** `POST /api/profile/onboarding`
* **Auth Required:** Yes (`braudle_token` cookie must be present)
* **Request Header:** `Content-Type: application/json`
* **Description:** Submits onboarding questionnaire results. Creates the `StudentProfile` and permanently flags the User's `onboardingComplete` status to `true`. Runs once per user.
* **Request Body Schema (Zod Validated):**
  ```json
  {
    "studyLevel": "secondary",
    "subjects": ["Biology", "Chemistry"],
    "learningStyle": "explain_first",
    "goal": "scholarship",
    "level": "beginner"
  }
  ```
* **Allowed Values & Constraints:**
  - `studyLevel`: Must be one of `["secondary", "university", "professional", "self"]`.
  - `subjects`: An array of strings. Minimum 1 subject, maximum 5 subjects. Each subject must be between 1 and 100 characters.
  - `learningStyle`: Must be one of `["explain_first", "test_first", "mix"]`.
  - `goal`: Must be one of `["pass_exams", "scholarship", "understand", "stay_ahead"]`.
  - `level`: Must be one of `["beginner", "intermediate", "advanced"]`.
* **Response Status Codes:**
  - `200 OK`: Onboarding completed and profile successfully created.
  - `400 Bad Request`: Validation error or onboarding already completed.
  - `401 Unauthorized`: Access token missing or invalid.
* **Response Example (`200 OK`):**
  ```json
  {
    "message": "Onboarding complete",
    "profile": {
      "userId": "60d5ec493d8b2d2f78c8577a",
      "level": "beginner",
      "learningStyle": "explain_first",
      "goal": "scholarship",
      "subjects": [
        "Biology",
        "Chemistry"
      ],
      "weakTopics": [],
      "strongTopics": [],
      "xp": 0,
      "streak": 0,
      "longestStreak": 0,
      "totalSessions": 0,
      "averageScore": 0,
      "weeklyChallenge": {
        "progress": 0,
        "completed": false
      },
      "learningHistory": [],
      "_id": "60d5ed1e3d8b2d2f78c8577d",
      "createdAt": "2026-06-01T18:00:00.000Z",
      "updatedAt": "2026-06-01T18:00:00.000Z"
    }
  }
  ```
* **Frontend Validation Rules (Highly Recommended before API call):**
  - **Subject Select Limit:** Do not let the student check more than 5 subjects in the tag cloud UI. Disable other subject checkboxes once 5 are selected.
  - **Required Fields:** Ensure the user has selected a value for `studyLevel`, `learningStyle`, `goal`, and `level` before submitting the form.
  - **Redirect Action:** On successful `200 OK` response, update the local user state (`onboardingComplete = true`) and immediately redirect the user to `/dashboard`.

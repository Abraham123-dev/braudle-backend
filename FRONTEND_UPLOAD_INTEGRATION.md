# Frontend Upload and Study Session Integration

This note describes the backend behavior the frontend must follow for document
uploads and study-session creation.

## Core lifecycle

The upload process is asynchronous:

```text
1. Request an upload URL
2. Upload the file directly to R2
3. Confirm the upload with the API
4. Wait for the background processing job
5. Start the study session only when the document is ready
```

Upload confirmation means that the processing job was queued. It does not mean
that document analysis has finished.

## Required frontend flow

```js
const upload = await createUploadSession(file);

await uploadDirectlyToStorage(upload.fileUrl, file);

await api.post('/api/documents/confirm-upload', {
  documentId: upload.documentId,
  fileHash,
});

const documentStatus = await waitForDocumentReady(upload.documentId);

const session = await api.post('/api/sessions/start', {
  documentId: documentStatus.documentId,
  mode: 'understand',
});
```

Do not call `/api/sessions/start` immediately after `confirm-upload`.

## Document status endpoint

```http
GET /api/documents/:documentId/status
```

The response contains:

```json
{
  "documentId": "document-id",
  "processingStatus": "pending",
  "processingStage": "file_received",
  "knowledgeCacheStatus": "pending",
  "topics": [],
  "summary": ""
}
```

### Processing status values

| `processingStatus` | Meaning | Frontend action |
|---|---|---|
| `pending` | The upload is waiting to be claimed by a worker | Keep waiting |
| `processing` | The worker is processing the document | Show progress |
| `ready` | The document can be used for a study session | Start the session |
| `failed` | Processing failed | Show a retry/re-upload action |

### Processing stage values

| `processingStage` | Suggested progress |
|---|---:|
| `file_received` | 10% |
| `extracting_content` | 30% |
| `identifying_concepts` | 50% |
| `building_learning_map` | 56% |
| `preparing_tutor` | 75% |
| `ready` | 100% |
| `failed` | Error state |

The percentage is a frontend presentation value. The backend returns the stage,
not a numeric percentage.

## Recommended polling implementation

Poll every 2–5 seconds. Stop polling when the document is ready or failed.

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForDocumentReady(documentId) {
  const maxAttempts = 120;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await api.get(
      `/api/documents/${documentId}/status`,
      { cache: 'no-store' }
    );

    const status = response.data;

    if (status.processingStatus === 'ready') {
      return status;
    }

    if (status.processingStatus === 'failed') {
      throw new Error('Document analysis failed. Please try uploading again.');
    }

    await sleep(3000);
  }

  throw new Error('Document analysis is taking longer than expected.');
}
```

If the HTTP client does not support `cache: 'no-store'`, configure an equivalent
no-cache option. The backend status endpoint sends `Cache-Control: no-store`,
but the frontend should also avoid caching status requests.

## SSE progress endpoint

The backend also exposes:

```http
GET /api/documents/:documentId/progress
```

The stream sends events shaped like:

```text
data: {"documentId":"...","stage":"building_learning_map","status":"processing"}
```

Heartbeat events can contain:

```json
{
  "stage": "building_learning_map",
  "status": "processing",
  "heartbeat": true
}
```

Heartbeats mean that processing is still active. They do not represent a new
processing stage and should not reset the progress bar.

When the stream sends:

```json
{
  "stage": "ready",
  "status": "ready"
}
```

the frontend may start the study session.

The stream can close after:

```text
data: [DONE]
```

Treat the status endpoint as the source of truth if the SSE connection closes.

## Starting a study session

```http
POST /api/sessions/start
```

Request body:

```json
{
  "documentId": "document-id",
  "mode": "understand"
}
```

The backend now requires the document to have:

```text
processingStatus: "ready"
```

### Successful response

```json
{
  "status": "success",
  "sessionId": "session-id",
  "documentId": "document-id",
  "mode": "understand",
  "message": "Your study session is ready! Let's start learning together."
}
```

### Document still processing

The backend returns HTTP `409`:

```json
{
  "status": "error",
  "message": "Document analysis is still in progress (building_learning_map).",
  "errorId": "err_..."
}
```

The frontend should return to the progress state and continue waiting. It should
not show this as a permanent upload failure.

### Document processing failed

The backend returns HTTP `422`:

```json
{
  "status": "error",
  "message": "Document analysis failed. Please upload the document again.",
  "errorId": "err_..."
}
```

Show a retry or re-upload action.

## Idempotent upload confirmation

The user may retry `confirm-upload` after a network timeout. The backend protects
the operation from consuming quota or queueing duplicate work more than once.

The frontend should:

- keep the same `documentId` when retrying
- avoid creating a second upload session for a request timeout unless the upload
  itself is known to have failed
- accept an idempotent success response as a successful confirmation

## Error handling rules

| Situation | Frontend behavior |
|---|---|
| `confirm-upload` returns `200` | Start waiting for document readiness |
| `confirm-upload` returns `429` | Show quota message |
| Session start returns `409` | Continue waiting for document readiness |
| Session start returns `422` | Show analysis failure and re-upload action |
| Status returns `failed` | Show analysis failure and re-upload action |
| Status request temporarily fails | Retry with backoff; do not immediately mark the document failed |
| SSE disconnects | Fall back to status polling |

Production error responses contain an `errorId` for support/debugging. Do not
display internal stack traces or credentials in the UI.

## Important implementation detail

The frontend must not interpret:

```text
confirm-upload succeeded
```

as:

```text
document is ready
```

The correct readiness condition is:

```js
status.processingStatus === 'ready'
```

Only then should the frontend call `/api/sessions/start`.

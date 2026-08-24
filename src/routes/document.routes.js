import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { resetUploadCountersIfNeeded } from '../middleware/uploadLimit.middleware.js';
import { uploadSingle } from '../middleware/upload.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { presignBurstLimiter } from '../middleware/rateLimit.middleware.js';
import {
  uploadSchema,
  getPresignedUrlSchema,
  confirmUploadSchema,
  presignPartsSchema,
  completeMultipartSchema,
  abortMultipartSchema,
} from '../validators/document.validator.js';
import {
  uploadDocument,
  getDocuments,
  getDocument,
  getDocumentStatus,
  deleteDocument,
  getPresignedUrl,
  confirmUpload,
  initiateMultipart,
  presignParts,
  completeMultipart,
  abortMultipart,
  getDocumentConceptMap,
  getDocumentProgressStream,
  generateConceptFlashcards,
  getDocumentFlashcardDecks,
  getDocumentViewUrl,
} from '../controllers/document.controller.js';

const router = Router();

// DEPRECATED: Legacy upload route — buffers entire file in Node RAM via multer.
// Returns 410 Gone to force all callers onto the presigned URL path.
router.post('/upload', (_req, res) => {
  res.status(410).json({
    status: 'error',
    message: 'This upload method has been retired. Use POST /documents/presigned-url for direct-to-R2 upload.',
    docs: '/api/documents/presigned-url',
  });
});

// Direct single-file upload routes
router.post('/presigned-url', verifyJWT, presignBurstLimiter, resetUploadCountersIfNeeded, validate(getPresignedUrlSchema), getPresignedUrl);
router.post('/confirm-upload', verifyJWT, validate(confirmUploadSchema), confirmUpload);

// Multipart direct upload routes
router.post('/multipart/initiate', verifyJWT, presignBurstLimiter, resetUploadCountersIfNeeded, validate(getPresignedUrlSchema), initiateMultipart);
router.post('/multipart/presign-parts', verifyJWT, validate(presignPartsSchema), presignParts);
router.post('/multipart/complete', verifyJWT, validate(completeMultipartSchema), completeMultipart);
router.post('/multipart/abort', verifyJWT, validate(abortMultipartSchema), abortMultipart);

// Basic CRUD for documents
router.get('/', verifyJWT, getDocuments);
router.get('/:id', verifyJWT, getDocument);
router.get('/:id/status', verifyJWT, getDocumentStatus);
router.get('/:id/progress', verifyJWT, getDocumentProgressStream);
router.get('/:id/concept-map', verifyJWT, getDocumentConceptMap);
router.get('/:id/view', verifyJWT, getDocumentViewUrl);
router.post('/:id/concept-flashcards', verifyJWT, generateConceptFlashcards);
router.get('/:id/flashcard-decks', verifyJWT, getDocumentFlashcardDecks);
router.delete('/:id', verifyJWT, deleteDocument);

export default router;
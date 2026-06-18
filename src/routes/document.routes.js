import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { resetUploadCountersIfNeeded } from '../middleware/uploadLimit.middleware.js';
import { uploadSingle } from '../middleware/upload.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
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
} from '../controllers/document.controller.js';

const router = Router();

// Legacy upload method (via backend server)
router.post('/upload', verifyJWT, resetUploadCountersIfNeeded, uploadSingle, validate(uploadSchema), uploadDocument);

// Direct single-file upload routes
router.post('/presigned-url', verifyJWT, resetUploadCountersIfNeeded, validate(getPresignedUrlSchema), getPresignedUrl);
router.post('/confirm-upload', verifyJWT, validate(confirmUploadSchema), confirmUpload);

// Multipart direct upload routes
router.post('/multipart/initiate', verifyJWT, resetUploadCountersIfNeeded, validate(getPresignedUrlSchema), initiateMultipart);
router.post('/multipart/presign-parts', verifyJWT, validate(presignPartsSchema), presignParts);
router.post('/multipart/complete', verifyJWT, validate(completeMultipartSchema), completeMultipart);
router.post('/multipart/abort', verifyJWT, validate(abortMultipartSchema), abortMultipart);

// Basic CRUD for documents
router.get('/', verifyJWT, getDocuments);
router.get('/:id', verifyJWT, getDocument);
router.get('/:id/status', verifyJWT, getDocumentStatus);
router.delete('/:id', verifyJWT, deleteDocument);

export default router;
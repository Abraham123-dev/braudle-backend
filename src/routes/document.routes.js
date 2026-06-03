import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { resetUploadCountersIfNeeded } from '../middleware/uploadLimit.middleware.js';
import { uploadSingle } from '../middleware/upload.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { uploadSchema } from '../validators/document.validator.js';
import {
  uploadDocument,
  getDocuments,
  getDocument,
  deleteDocument,
} from '../controllers/document.controller.js';

const router = Router();

// POST /upload - Handle file upload with limits and validation
router.post('/upload', verifyJWT, resetUploadCountersIfNeeded, uploadSingle, validate(uploadSchema), uploadDocument);

// Basic CRUD for documents
router.get('/', verifyJWT, getDocuments);
router.get('/:id', verifyJWT, getDocument);
router.delete('/:id', verifyJWT, deleteDocument);

export default router;
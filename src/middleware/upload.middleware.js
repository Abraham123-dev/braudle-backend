// Multer middleware for file uploads
// Handles PDF (2/day, 50MB) and Image (5/day) uploads

import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF and image files are allowed', 400));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

export { upload };

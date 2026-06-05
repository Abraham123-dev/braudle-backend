import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import User from '../models/User.model.js';
import Document from '../models/Document.model.js';
import Session from '../models/Session.model.js';
import Conversation from '../models/Conversation.model.js';
import * as StorageService from '../services/storage.service.js';
import { documentQueue } from '../queues/document.queue.js';

/**
 * Handles document upload, R2 storage, and background task queuing 
 */

export const uploadDocument = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    throw new AppError('No file uploaded', 400);
  }

  // 1. Determine type based on mimetype
  const isPdf = file.mimetype === 'application/pdf';
  const type = isPdf ? 'pdf' : 'image';
  const limit = isPdf ? 2 : 5;
  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  // 1. Atomic check and increment of upload counters to prevent TOCTOU race
  const user = await User.findOneAndUpdate(
    { 
      _id: userId, 
      [countField]: { $lt: limit } 
    },
    { 
      $inc: { [countField]: 1 },
      $set: { lastUploadDate: new Date() }
    },
    { new: true }
  );

  if (!user) {
    const userExists = await User.exists({ _id: userId });
    if (!userExists) throw new AppError('User not found', 404);
    throw new AppError(`Daily ${type} upload limit reached (${limit}/day)`, 429);
  }

  // 2. Prepare storage key
  const sanitizedName = StorageService.sanitizeFilename(file.originalname);
  const fileKey = `uploads/${userId}/${Date.now()}-${sanitizedName}`;

  let fileUrl;
  let document;

  try {
    // 3. Upload to Cloudflare R2
    fileUrl = await StorageService.uploadToR2(file.buffer, fileKey, file.mimetype);

    // 4. Create Document record in MongoDB
    document = await Document.create({
      userId,
      title: req.body.title || file.originalname,
      subject: req.body.subject,
      type,
      fileUrl,
      fileKey,
      processingStatus: 'pending',
    });

    // 5. Queue the background processing job
    await documentQueue.add('process-document', {
      documentId: document._id,
      fileKey: document.fileKey,
      userId: document.userId,
    });

    return res.status(202).json({
      documentId: document._id,
      status: 'pending',
      message: 'Document received and queued for processing',
    });
  } catch (error) {
    // Rollback: decrement counter and cleanup created resources on failure
    await User.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });
    
    if (fileUrl) {
      await StorageService.deleteFromR2(fileKey);
    }
    
    if (document) {
      await Document.findByIdAndDelete(document._id);
    }
    
    throw error;
  }
});

export const getDocuments = asyncHandler(async (req, res) => {
  const documents = await Document.find({ userId: req.user.id })
    .select('-rawText -chunks')
    .sort({ createdAt: -1 });
    
  return res.status(200).json(documents);
});

export const getDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.id);

  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);

  return res.status(200).json(document);
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.id);

  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);

  const fileKey = document.fileKey;

  // 1. Identify all related sessions
  const sessions = await Session.find({ documentId: document._id }).select('_id');
  const sessionIds = sessions.map(s => s._id);

  // 2. Cascade delete: Conversations -> Sessions -> Document
  await Conversation.deleteMany({ sessionId: { $in: sessionIds } });
  await Session.deleteMany({ documentId: document._id });
  await document.deleteOne();

  // 3. Cleanup R2 storage (Async, non-blocking for the response)
  StorageService.deleteFromR2(fileKey).catch((err) => 
    console.error(`Failed to cleanup storage for key ${fileKey}:`, err)
  );

  return res.status(200).json({ message: 'Document deleted successfully' });
});
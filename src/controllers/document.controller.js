import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import crypto from 'crypto';
import { subscribeToProgress, unsubscribeFromProgress } from '../config/redisPubSub.js';
import User from '../models/User.model.js';
import Document from '../models/Document.model.js';
import Session from '../models/Session.model.js';
import Conversation from '../models/Conversation.model.js';
import Quiz from '../models/Quiz.model.js';
import FlashcardDeck from '../models/FlashcardDeck.model.js';
import StudentProfile from '../models/StudentProfile.model.js';
import MasteryConcept from '../models/MasteryConcept.model.js';
import * as StorageService from '../services/storage.service.js';
import { extractionQueue } from '../queues/document.queue.js';
import { env } from '../config/env.js';
import { deleteCached, CACHE_KEYS } from '../utils/cache.js';

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
  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  const userRecord = await User.findById(userId);
  if (!userRecord) throw new AppError('User not found', 404);

  const plan = userRecord.plan || 'free';

  // ── Step 1: Compute hash and run duplicate check BEFORE touching any counter.
  // Old order was: increment → check duplicate → rollback on duplicate (rollback was missing!).
  // A user uploading a duplicate would silently burn a daily quota slot.
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const duplicateForUser = await Document.findOne({ userId, fileHash });
  if (duplicateForUser) {
    throw new AppError("This document has already been uploaded to your library.", 400);
  }

  // ── Step 2: Size validation (no DB writes yet)
  if (isPdf) {
    const sizeLimits = { free: 10, plus: 25, pro: 50 };
    const maxSize = (sizeLimits[plan] ?? sizeLimits.free) * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppError(`PDF files must be under ${sizeLimits[plan] ?? sizeLimits.free}MB for your ${plan.toUpperCase()} plan.`, 400);
    }
  } else {
    if (file.size > 10 * 1024 * 1024) {
      throw new AppError('Image notes must be under 10MB.', 400);
    }
  }

  // ── Step 3: Atomic counter increment — check-and-set in a single DB round-trip.
  // The old pattern (read → check → separate write) had a race condition: two concurrent
  // uploads from the same user could both pass the limit check before either incremented.
  // findOneAndUpdate with $lt makes the check and the increment one atomic operation.
  let user;
  if (isPdf) {
    const isDev = env.nodeEnv === 'development';
    const isUnlimited = isDev || userRecord.role === 'admin' || plan === 'pro';

    if (isUnlimited) {
      user = await User.findByIdAndUpdate(
        userId,
        { $inc: { 'uploadCount.pdf': 1 }, $set: { lastUploadDate: new Date() } },
        { returnDocument: 'after' }
      );
    } else {
      const limit = plan === 'plus' ? 10 : 5;
      user = await User.findOneAndUpdate(
        { _id: userId, 'uploadCount.pdf': { $lt: limit } },
        { $inc: { 'uploadCount.pdf': 1 }, $set: { lastUploadDate: new Date() } },
        { returnDocument: 'after' }
      );
      if (!user) {
        throw new AppError(`You've reached your maximum daily limit of ${limit} PDF uploads for the ${plan.toUpperCase()} plan.`, 429);
      }
    }
  } else {
    // Images: no upload limit — just increment
    user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'uploadCount.image': 1 }, $set: { lastUploadDate: new Date() } },
      { returnDocument: 'after' }
    );
  }

  // Check for duplicate in cache
  const existingDoc = await Document.findOne({
    fileHash,
    processingStatus: 'ready',
  });

  if (existingDoc) {
    const document = await Document.create({
      userId,
      title: req.body.title || file.originalname,
      subject: req.body.subject,
      type,
      fileUrl: existingDoc.fileUrl,
      fileKey: existingDoc.fileKey,
      fileHash,
      processingStatus: 'ready',
      processingStage: 'ready',
      rawText: existingDoc.rawText,
      chunks: existingDoc.chunks,
      chunkEmbeddings: existingDoc.chunkEmbeddings,
      totalChunks: existingDoc.totalChunks,
      topics: existingDoc.topics,
      summary: existingDoc.summary,
      detailedSummary: existingDoc.detailedSummary,
      aiUnderstandingFailed: existingDoc.aiUnderstandingFailed,
      knowledgeCacheStatus: existingDoc.knowledgeCacheStatus,
      knowledgeCache: existingDoc.knowledgeCache,
      conceptMapStatus: existingDoc.conceptMapStatus,
      conceptMap: existingDoc.conceptMap,
    });

    return res.status(200).json({
      documentId: document._id,
      status: 'ready',
      message: "BRAUDLE already knows this document! Loaded instantly from ingestion cache.",
    });
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
      fileHash,
      processingStatus: 'pending',
    });

    // 5. Queue the background processing job
    await extractionQueue.add('process-document', {
      documentId: document._id,
      fileKey: document.fileKey,
      userId: document.userId,
      plan: userRecord.plan || 'free'
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 300000 // 5 minutes
    });

    return res.status(202).json({
      documentId: document._id,
      status: 'pending',
      message: "Upload complete! BRAUDLE is studying your notes in the background now.",
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

export const getDocumentStatus = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.id)
    .select('processingStatus processingStage knowledgeCacheStatus topics summary userId');

  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);

  return res.status(200).json({
    documentId: document._id,
    processingStatus: document.processingStatus,
    processingStage: document.processingStage,
    knowledgeCacheStatus: document.knowledgeCacheStatus,
    // Returned once stage reaches 'ready' — frontend uses these to render the welcome card
    topics: document.topics,
    summary: document.summary,
  });
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.id);

  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);

  const fileKey = document.fileKey;

  // 1. Identify all related sessions
  const sessions = await Session.find({ documentId: document._id }).select('_id');
  const sessionIds = sessions.map(s => s._id);

  // 2. Cascade delete all linked records to prevent database orphan accumulation:
  // Conversations -> Quizzes -> Sessions -> Decks -> MasteryConcepts -> Saved Flashcards -> Document
  await Conversation.deleteMany({ sessionId: { $in: sessionIds } });
  await Quiz.deleteMany({ sessionId: { $in: sessionIds } });
  await Session.deleteMany({ documentId: document._id });
  await FlashcardDeck.deleteMany({ documentId: document._id });
  await MasteryConcept.deleteMany({ documentId: document._id });
  
  // Clean user profile's embedded saved flashcards array of cards referring to this doc
  await StudentProfile.updateMany(
    { userId: req.user.id },
    { $pull: { savedFlashcards: { documentId: document._id } } }
  );

  await document.deleteOne();

  // 3. Invalidate dashboard performance cache so score updates are reflected immediately
  await deleteCached(CACHE_KEYS.DASHBOARD_PERF(req.user.id));

  // 4. Cleanup R2 storage (Async, non-blocking for the response)
  StorageService.deleteFromR2(fileKey).catch((err) => 
    console.error(`Failed to cleanup storage for key ${fileKey}:`, err)
  );

  return res.status(200).json({ message: 'Document deleted successfully' });
});

/**
 * Generates a presigned URL for direct upload to Cloudflare R2
 */
export const getPresignedUrl = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { title, subject, filename, contentType, fileHash } = req.body;

  // Determine type based on contentType or filename extension
  const isPdf = contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  const type = isPdf ? 'pdf' : 'image';

  // Instant deduplication check (bypasses R2 upload and daily limits)
  if (fileHash) {
    // Check if this user has already uploaded this document in their library
    const duplicateForUser = await Document.findOne({
      userId,
      fileHash,
    });
    if (duplicateForUser) {
      throw new AppError("This document has already been uploaded to your library.", 400);
    }

    const existingDoc = await Document.findOne({
      fileHash,
      processingStatus: 'ready',
    });

    if (existingDoc) {
      const document = await Document.create({
        userId,
        title: title || filename,
        subject,
        type,
        fileUrl: existingDoc.fileUrl,
        fileKey: existingDoc.fileKey,
        fileHash,
        processingStatus: 'ready',
        processingStage: 'ready',
        rawText: existingDoc.rawText,
        chunks: existingDoc.chunks,
        chunkEmbeddings: existingDoc.chunkEmbeddings,
        totalChunks: existingDoc.totalChunks,
        topics: existingDoc.topics,
        summary: existingDoc.summary,
        detailedSummary: existingDoc.detailedSummary,
        aiUnderstandingFailed: existingDoc.aiUnderstandingFailed,
        knowledgeCacheStatus: existingDoc.knowledgeCacheStatus,
        knowledgeCache: existingDoc.knowledgeCache,
        conceptMapStatus: existingDoc.conceptMapStatus,
        conceptMap: existingDoc.conceptMap,
      });

      return res.status(200).json({
        documentId: document._id,
        status: 'ready',
        message: "BRAUDLE already knows this document! Loaded instantly from ingestion cache.",
        cached: true,
      });
    }
  }

  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  // ── Limit check only (no increment yet — we increment in confirmUpload after
  // the R2 upload succeeds, preventing quota loss on failed uploads) ──────────
  const userRecord = await User.findById(userId);
  if (!userRecord) throw new AppError('User not found', 404);
  const plan = userRecord.plan || 'free';

  if (isPdf) {
    const isDev = env.nodeEnv === 'development';
    let limit = 5;
    if (isDev) limit = 50;
    else if (userRecord.role === 'admin' || plan === 'pro') limit = 1000;
    else if (plan === 'plus') limit = 10;

    if (userRecord.uploadCount.pdf >= limit) {
      throw new AppError(`You've reached your maximum daily limit of ${limit} PDF uploads for the ${plan.toUpperCase()} plan.`, 429);
    }
  }

  const sanitizedName = StorageService.sanitizeFilename(filename);
  const fileKey = `uploads/${userId}/${Date.now()}-${sanitizedName}`;
  const publicDomain = env.cfR2.publicUrl.replace(/^https?:\/\//, '');
  const fileUrl = `https://${publicDomain}/${fileKey}`;

  // Generate presigned PUT URL and create pending Document record
  const uploadUrl = await StorageService.getPresignedPutUrl(fileKey, contentType);

  const document = await Document.create({
    userId,
    title: title || filename,
    subject,
    type,
    fileUrl,
    fileKey,
    processingStatus: 'pending',
  });

  return res.status(200).json({
    documentId: document._id,
    uploadUrl,
    fileKey,
    fileUrl,
    message: 'Presigned upload URL generated successfully. Upload your file directly to this URL.',
  });
});

/**
 * Confirms that a direct upload was successfully completed
 * and queues the background parsing job
 */
export const confirmUpload = asyncHandler(async (req, res) => {
  const { documentId, fileHash } = req.body;
  const userId = req.user.id;

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError('Document not found', 404);
  }

  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  // Stamp file hash for deduplication (computed client-side in parallel with presign request)
  if (fileHash && !document.fileHash) {
    await Document.findByIdAndUpdate(documentId, { fileHash });
  }

  const user = await User.findById(userId);
  const plan = user?.plan || 'free';
  const isPdf = document.type === 'pdf';
  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  // ── Atomically increment the upload counter now that the file has landed ───
  // This is the correct place — the R2 upload already succeeded at this point.
  await User.findByIdAndUpdate(userId, {
    $inc: { [countField]: 1 },
    $set: { lastUploadDate: new Date() },
  });

  try {
    // Queue the background processing job
    await extractionQueue.add('process-document', {
      documentId: document._id,
      fileKey: document.fileKey,
      userId: document.userId,
      plan
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 300000 // 5 minutes
    });
  } catch (queueErr) {
    // If queuing fails, roll back counter and delete the orphan doc
    await User.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });
    await Document.findByIdAndDelete(document._id);
    throw queueErr;
  }

  return res.status(200).json({
    documentId: document._id,
    status: 'pending',
    message: 'Upload confirmed! BRAUDLE is studying your notes in the background now.',
  });
});

/**
 * Initiates a multipart upload session with R2
 */
export const initiateMultipart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { title, subject, filename, contentType } = req.body;

  const isPdf = contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  const type = isPdf ? 'pdf' : 'image';
  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  let user;
  if (isPdf) {
    const userRecord = await User.findById(userId);
    if (!userRecord) throw new AppError('User not found', 404);
    const plan = userRecord.plan || 'free';
    const isDev = env.nodeEnv === 'development';

    let limit = 5;
    if (isDev) {
      limit = 50;
    } else if (userRecord.role === 'admin' || plan === 'pro') {
      limit = 1000;
    } else if (plan === 'plus') {
      limit = 10;
    }

    user = await User.findOneAndUpdate(
      { 
        _id: userId, 
        'uploadCount.pdf': { $lt: limit } 
      },
      { 
        $inc: { 'uploadCount.pdf': 1 },
        $set: { lastUploadDate: new Date() }
      },
      { returnDocument: 'after' }
    );

    if (!user) {
      throw new AppError(`You've reached your maximum daily limit of ${limit} PDF uploads for the ${plan.toUpperCase()} plan.`, 429);
    }
  } else {
    // Images are unlimited
    user = await User.findByIdAndUpdate(
      userId,
      { 
        $inc: { 'uploadCount.image': 1 },
        $set: { lastUploadDate: new Date() }
      },
      { returnDocument: 'after' }
    );
    if (!user) {
      throw new AppError('User not found', 404);
    }
  }

  const sanitizedName = StorageService.sanitizeFilename(filename);
  const fileKey = `uploads/${userId}/${Date.now()}-${sanitizedName}`;
  const publicDomain = env.cfR2.publicUrl.replace(/^https?:\/\//, '');
  const fileUrl = `https://${publicDomain}/${fileKey}`;

  let uploadId;
  let document;

  try {
    uploadId = await StorageService.initiateMultipartUpload(fileKey, contentType);

    document = await Document.create({
      userId,
      title: title || filename,
      subject,
      type,
      fileUrl,
      fileKey,
      processingStatus: 'pending',
    });

    return res.status(200).json({
      documentId: document._id,
      uploadId,
      fileKey,
      fileUrl,
      message: 'Multipart upload initiated successfully.',
    });
  } catch (error) {
    await User.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });
    throw error;
  }
});

/**
 * Generates presigned URLs for specific parts of a multipart upload
 */
export const presignParts = asyncHandler(async (req, res) => {
  const { uploadId, fileKey, partNumbers } = req.body;

  const parts = [];
  for (const partNumber of partNumbers) {
    const uploadUrl = await StorageService.getPresignedUploadPartUrl(fileKey, uploadId, partNumber);
    parts.push({ partNumber, uploadUrl });
  }

  return res.status(200).json({ parts });
});

/**
 * Completes a multipart upload, registers it in R2, and queues background processing
 */
export const completeMultipart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentId, uploadId, fileKey, parts } = req.body;

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError('Document not found', 404);
  }

  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  // Complete the upload on R2
  const fileUrl = await StorageService.completeMultipartUpload(fileKey, uploadId, parts);

  // Update document file URL to the resolved completed URL
  document.fileUrl = fileUrl;
  await document.save();

  const user = await User.findById(userId);
  const plan = user?.plan || 'free';

  // Bug fix: completeMultipart was the only upload path that queued jobs without
  // explicit options, falling back to BullMQ defaults (3 attempts, 1s delay, no timeout).
  // Large files uploaded via multipart need the same resilience as other upload paths.
  await extractionQueue.add('process-document', {
    documentId: document._id,
    fileKey: document.fileKey,
    userId: document.userId,
    plan,
  }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: 300000, // 5 minutes — multipart files are large, give the worker time
  });

  return res.status(200).json({
    documentId: document._id,
    status: 'pending',
    fileUrl,
    message: 'Multipart upload completed! BRAUDLE is studying your notes in the background now.',
  });
});

/**
 * Aborts a multipart upload session, clearing memory and resetting rate limits
 */
export const abortMultipart = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentId, uploadId, fileKey } = req.body;

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError('Document not found', 404);
  }

  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  const isPdf = document.type === 'pdf';
  const countField = isPdf ? 'uploadCount.pdf' : 'uploadCount.image';

  try {
    // Abort on R2
    await StorageService.abortMultipartUpload(fileKey, uploadId);
  } catch (r2Err) {
    console.error('Error aborting multipart on R2:', r2Err);
  }

  // Rollback MongoDB document and counter
  await document.deleteOne();
  await User.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });

  return res.status(200).json({
    success: true,
    message: 'Multipart upload aborted and resources cleaned up.',
  });
});

/**
 * Retrieves the concept map for a document.
 * If not already generated, it dynamically builds it using cached concepts and topics.
 * GET /api/documents/:id/concept-map
 */
export const getDocumentConceptMap = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const document = await Document.findById(id);
  if (!document) {
    throw new AppError('Document not found', 404);
  }

  // Ensure user owns document
  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  // 1. If concept map exists, return it
  if (document.conceptMap && document.conceptMap.chapters && document.conceptMap.chapters.length > 0) {
    return res.status(200).json({
      status: 'success',
      conceptMap: document.conceptMap
    });
  }

  if (document.conceptMapStatus === 'generating') {
    return res.status(202).json({
      status: 'generating',
      message: 'Concept map is currently being generated. Please check back shortly.'
    });
  }

  // 2. Lazy Generation Fallback
  console.log(`[CONCEPT MAP] Lazy generating map for document: ${id}`);
  const cache = document.knowledgeCache || {};
  const examTopics = cache.examTopics || [];
  const concepts = cache.concepts || [];

  try {
    document.conceptMapStatus = 'generating';
    await document.save();

    const { generateAIResponse } = await import('../services/ai.service.js');
    const { parseAIJson } = await import('../utils/parseAIJson.js');

    let prompt = '';

    // If we have concepts in DB cache, build curriculum map from cache (fast/efficient)
    if (concepts.length > 0) {
      prompt = `You are an expert curriculum designer.
Analyze the following document topics and key concepts and structure them into a hierarchical learning map (Subject ➔ Chapters/Topics ➔ Concepts).

Subject Title: "${document.title}"
Exam/Major Topics: ${JSON.stringify(examTopics)}
Key Concepts: ${JSON.stringify(concepts.map(c => ({ name: c.name, explanation: c.explanation })))}

Organize this information into a logical, hierarchical structure suitable for visual exploration. Group each concept under its most relevant exam topic/chapter. If an exam topic doesn't have matching concepts from the list, you can define 1-2 important concepts for it.

Return ONLY a valid JSON object matching this schema. No markdown code blocks, no explanation, no trailing characters.

Schema:
{
  "title": "Subject Title",
  "chapters": [
    {
      "id": "ch-1",
      "title": "Chapter/Topic Title",
      "summary": "Short 1-sentence recap...",
      "concepts": [
        {
          "id": "concept-1.1",
          "name": "Concept Name",
          "explanation": "Brief 1-sentence definition..."
        }
      ]
    }
  ]
}
`;
    } else if (document.chunks && document.chunks.length > 0) {
      // Fallback: If knowledgeCache is empty, generate map directly from document chunks (NotebookLM style)
      console.log(`[CONCEPT MAP] knowledgeCache empty, fallback to raw chunk ingestion mapping.`);
      const sampleText = document.chunks.slice(0, 15).join('\n\n');
      prompt = `You are an expert curriculum designer.
Analyze the following document text and structure it into a hierarchical learning map (Subject ➔ Chapters/Topics ➔ Concepts).

Subject Title: "${document.title}"

DOCUMENT TEXT (sampled):
${sampleText}

Organize the document contents into a logical, hierarchical structure suitable for visual exploration. Group each key concept under its most relevant chapter/topic. Extract 3-6 chapters, and 2-4 key concepts per chapter.

Return ONLY a valid JSON object matching this schema. No markdown code blocks, no explanation, no trailing characters.

Schema:
{
  "title": "Subject Title",
  "chapters": [
    {
      "id": "ch-1",
      "title": "Chapter/Topic Title",
      "summary": "Short 1-sentence recap...",
      "concepts": [
        {
          "id": "concept-1.1",
          "name": "Concept Name",
          "explanation": "Brief 1-sentence definition..."
        }
      ]
    }
  ]
}
`;
    }

    if (prompt) {
      // Using 'tutoring' task to target the larger, smarter 70B parameter model!
      const cacheResponse = await generateAIResponse({
        task: 'tutoring',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 3000
      });

      const parsedMap = parseAIJson(cacheResponse, null);
      if (parsedMap && Array.isArray(parsedMap.chapters) && parsedMap.chapters.length > 0) {
        document.conceptMap = parsedMap;
        document.conceptMapStatus = 'ready';
        await document.save();
        return res.status(200).json({
          status: 'success',
          conceptMap: parsedMap
        });
      }
    }
  } catch (err) {
    console.error('[CONCEPT MAP] Lazy generation failed:', err.message);
    document.conceptMapStatus = 'failed';
    await document.save();
  }

  // Final placeholder fallback if everything else fails
  const basicMap = {
    title: document.title,
    chapters: [
      {
        id: 'ch-1',
        title: 'Core Topics',
        summary: 'Fundamental topics in this study material.',
        concepts: concepts.length > 0 
          ? concepts.slice(0, 6).map((c, idx) => ({
              id: `concept-${idx}`,
              name: c.name,
              explanation: c.explanation
            }))
          : [
              {
                id: 'concept-1',
                name: document.title,
                explanation: 'Explore the details and study this note in the tutor chat.'
              }
            ]
      }
    ]
  };
  
  document.conceptMap = basicMap;
  document.conceptMapStatus = 'ready';
  await document.save();

  return res.status(200).json({
    status: 'success',
    conceptMap: basicMap
  });
});

export const getDocumentProgressStream = (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Encoding': 'none',
  });

  // Keep-alive heartbeat every 15s — prevents proxy/gateway idle-connection timeouts
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // Hard cap at 10 minutes — prevents zombie SSE connections on stalled uploads
  const maxTimeout = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'Processing timed out. Please try refreshing.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }, 10 * 60 * 1000);

  // Bug fix: the old pattern spawned a new ioredis connection per SSE client, exhausting
  // the Redis connection pool under concurrent uploads. We now use one shared subscriber
  // (redisPubSub.js) that multiplexes all active channels over a single connection.
  const channel = `doc:progress:${id}`;
  let writeFn = null; // kept in scope so we can unsubscribe on cleanup

  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(maxTimeout);
    if (writeFn) {
      unsubscribeFromProgress(channel, writeFn).catch(() => {});
      writeFn = null;
    }
  };

  // Safe end helper — guards against writing to a closed response
  const endStream = () => {
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };

  req.on('close', cleanup);

  (async () => {
    try {
      const document = await Document.findById(id);
      if (!document) {
        res.write(`data: ${JSON.stringify({ error: 'Document not found' })}\n\n`);
        return endStream();
      }

      if (document.userId.toString() !== userId) {
        res.write(`data: ${JSON.stringify({ error: 'Forbidden: Access denied' })}\n\n`);
        return endStream();
      }

      // 1. Push current state immediately so the frontend renders the right stage
      res.write(`data: ${JSON.stringify({
        documentId: document._id,
        stage: document.processingStage,
        status: document.processingStatus,
        topics: document.topics,
        summary: document.summary
      })}\n\n`);

      // If already done (both processing and cache are settled), close immediately
      if (
        ['ready', 'failed'].includes(document.processingStatus) &&
        ['ready', 'failed'].includes(document.knowledgeCacheStatus)
      ) {
        return endStream();
      }

      // 2. Subscribe through the shared pub/sub client
      writeFn = (message) => {
        if (res.writableEnded) return;
        res.write(`data: ${message}\n\n`);

        try {
          const parsed = JSON.parse(message);
          if (['ready_cache', 'failed_cache', 'failed'].includes(parsed.status)) {
            endStream();
          }
        } catch {
          // Ignore malformed publish payloads
        }
      };

      await subscribeToProgress(channel, writeFn);

    } catch (err) {
      console.error(`[SSE STREAM] Error setting up progress stream for doc ${id}:`, err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        endStream();
      }
    }
  })();
};

export const generateConceptFlashcards = asyncHandler(async (req, res) => {
  const { conceptName, sessionId, count } = req.body;
  const { id } = req.params;
  const userId = req.user.id;

  if (!conceptName) {
    throw new AppError('Concept name is required', 400);
  }

  const document = await Document.findOne({ _id: id, userId });
  if (!document) {
    throw new AppError('Document not found or access denied', 404);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // 1. Enforce flashcards generation limit — check only
  const { checkGenLimit, recordGenLimit } = await import('./quiz.controller.js');
  await checkGenLimit(user, document, 'flashcards');

  // 2. Call AI service to generate flashcards
  const { generateAIResponse } = await import('../services/ai.service.js');
  const { buildConceptFlashcardsPrompt } = await import('../utils/promptBuilder.js');
  const { parseAIJson } = await import('../utils/parseAIJson.js');

  const cardCount = count ? parseInt(count, 10) : 10;
  const prompt = buildConceptFlashcardsPrompt(document.chunks, conceptName, cardCount);
  const aiResponse = await generateAIResponse({
    task: 'tutoring',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000
  });

  const flashcards = parseAIJson(aiResponse, []);

  if (!Array.isArray(flashcards) || flashcards.length === 0) {
    throw new AppError('Failed to generate valid concept flashcards. Please try again.', 500);
  }

  const normalizedCards = flashcards.map(fc => ({
    topic: fc.topic || conceptName,
    front: fc.front,
    back: fc.back
  }));

  // Consume limit upon successful generation
  await recordGenLimit(user, document, 'flashcards');

  // 3. Persist messages in the session conversation if sessionId is provided
  if (sessionId) {
    const conversation = await Conversation.findOne({ sessionId, userId });
    if (conversation) {
      const userText = `Please generate exactly ${cardCount} flashcards from our study materials. Focus on the concept: "${conceptName}"`;
      
      const formattedLines = normalizedCards.map(fc => 
        `FLASHCARD | TOPIC: ${fc.topic} | FRONT: ${fc.front} | BACK: ${fc.back}`
      );
      formattedLines.push(`💡 These flashcards have been saved to your profile. Want to keep studying, try a practice question, or move to the next section?`);
      const assistantText = formattedLines.join('\n');

      conversation.messages.push({
        role: 'user',
        content: userText,
        timestamp: new Date()
      });

      conversation.messages.push({
        role: 'assistant',
        content: assistantText,
        timestamp: new Date()
      });

      await conversation.save();
    }
  }

  // 4. Save the generated deck persistently
  const newDeck = await FlashcardDeck.create({
    userId,
    documentId: id,
    sessionId: sessionId || null,
    conceptName: conceptName || 'General',
    cards: normalizedCards,
    cardCount: normalizedCards.length
  });

  // 5. Save flashcards to user's student profile library
  const profileCards = normalizedCards.map(fc => ({
    documentId: document._id,
    documentTitle: document.title,
    topic: fc.topic || 'General',
    front: fc.front,
    back: fc.back
  }));

  await StudentProfile.findOneAndUpdate(
    { userId },
    { $push: { savedFlashcards: { $each: profileCards } } },
    { returnDocument: 'after', upsert: true }
  );

  // Invalidate profile cache
  const { deleteCached: delCache, CACHE_KEYS: keys } = await import('../utils/cache.js');
  await delCache(keys.PROFILE(userId));

  return res.status(200).json({
    status: 'success',
    flashcards: normalizedCards,
    deck: newDeck
  });
});

export const getDocumentFlashcardDecks = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const document = await Document.findOne({ _id: id, userId });
  if (!document) {
    throw new AppError('Document not found or access denied', 404);
  }

  const decks = await FlashcardDeck.find({ documentId: id, userId }).sort({ createdAt: -1 });

  return res.status(200).json({
    status: 'success',
    decks
  });
});

export const getDocumentViewUrl = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const document = await Document.findOne({ _id: id, userId });
  if (!document) {
    throw new AppError('Document not found or access denied', 404);
  }

  const viewUrl = await StorageService.getPresignedGetUrl(document.fileKey);

  return res.status(200).json({
    status: 'success',
    viewUrl,
    type: document.type,
  });
});
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import User from '../models/User.model.js';
import Document from '../models/Document.model.js';
import Session from '../models/Session.model.js';
import Conversation from '../models/Conversation.model.js';
import Quiz from '../models/Quiz.model.js';
import * as StorageService from '../services/storage.service.js';
import { documentQueue } from '../queues/document.queue.js';
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

  let user;
  if (isPdf) {
    const sizeLimits = { free: 10, plus: 25, pro: 50 };
    const uploadLimits = { free: 5, plus: 10, pro: Infinity };

    const maxSize = sizeLimits[plan] * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppError(`PDF files must be under ${sizeLimits[plan]}MB for your ${plan.toUpperCase()} plan.`, 400);
    }

    const limit = uploadLimits[plan];
    if (userRecord.uploadCount.pdf >= limit) {
      throw new AppError(`You've reached your maximum daily limit of ${limit} PDF uploads for the ${plan.toUpperCase()} plan.`, 429);
    }

    user = await User.findByIdAndUpdate(
      userId,
      { 
        $inc: { 'uploadCount.pdf': 1 },
        $set: { lastUploadDate: new Date() }
      },
      { returnDocument: 'after' }
    );
  } else {
    // Images are unlimited
    if (file.size > 10 * 1024 * 1024) {
      throw new AppError('Image notes must be under 10MB.', 400);
    }

    user = await User.findByIdAndUpdate(
      userId,
      { 
        $inc: { 'uploadCount.image': 1 },
        $set: { lastUploadDate: new Date() }
      },
      { returnDocument: 'after' }
    );
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
    .select('processingStatus processingStage topics summary userId');

  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);

  return res.status(200).json({
    documentId: document._id,
    processingStatus: document.processingStatus,
    processingStage: document.processingStage,
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

  // 2. Cascade delete: Conversations -> Quizzes -> Sessions -> Document
  await Conversation.deleteMany({ sessionId: { $in: sessionIds } });
  await Quiz.deleteMany({ sessionId: { $in: sessionIds } });
  await Session.deleteMany({ documentId: document._id });
  await document.deleteOne();

  // 3. Invalidate dashboard performance cache so score updates are reflected immediately
  await deleteCached(CACHE_KEYS.DASHBOARD_PERF(req.user.id));

  // 3. Cleanup R2 storage (Async, non-blocking for the response)
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
  const { title, subject, filename, contentType } = req.body;

  // Determine type based on contentType or filename extension
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

  let uploadUrl;
  let document;

  try {
    // Generate presigned PUT URL
    uploadUrl = await StorageService.getPresignedPutUrl(fileKey, contentType);

    // Create Document record in MongoDB (status: pending)
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
      uploadUrl,
      fileKey,
      fileUrl,
      message: 'Presigned upload URL generated successfully. Upload your file directly to this URL.',
    });
  } catch (error) {
    // Rollback: decrement counter on failure
    await User.findByIdAndUpdate(userId, { $inc: { [countField]: -1 } });
    throw error;
  }
});

/**
 * Confirms that a direct upload was successfully completed
 * and queues the background parsing job
 */
export const confirmUpload = asyncHandler(async (req, res) => {
  const { documentId } = req.body;
  const userId = req.user.id;

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError('Document not found', 404);
  }

  if (document.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  // Queue the background processing job
  await documentQueue.add('process-document', {
    documentId: document._id,
    fileKey: document.fileKey,
    userId: document.userId,
  });

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

  // Queue background processing
  await documentQueue.add('process-document', {
    documentId: document._id,
    fileKey: document.fileKey,
    userId: document.userId,
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

  // 2. Lazy Generation Fallback
  console.log(`[CONCEPT MAP] Lazy generating map for document: ${id}`);
  const cache = document.knowledgeCache || {};
  const examTopics = cache.examTopics || [];
  const concepts = cache.concepts || [];

  try {
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
        await document.save();
        return res.status(200).json({
          status: 'success',
          conceptMap: parsedMap
        });
      }
    }
  } catch (err) {
    console.error('[CONCEPT MAP] Lazy generation failed:', err.message);
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
  await document.save();

  return res.status(200).json({
    status: 'success',
    conceptMap: basicMap
  });
});
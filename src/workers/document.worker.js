import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import Document from '../models/Document.model.js';
import * as StorageService from '../services/storage.service.js';
import { splitIntoChunks, splitIntoChunksSemantic } from '../utils/chunker.js';
import { 
  buildDocumentUnderstandingPrompt, 
  buildKnowledgeCachePromptA, 
  buildKnowledgeCachePromptB 
} from '../utils/promptBuilder.js';
import { PDFParse } from 'pdf-parse';
import * as AIService from '../services/ai.service.js';
import { GROQ_MODELS } from '../config/models.js';
import { parseAIJson } from '../utils/parseAIJson.js';
import { detectQuestionsInDocument } from '../utils/documentAnalyzer.js';
import crypto from 'crypto';
import AppErrorLog from '../models/AppErrorLog.model.js';
import Conversation from '../models/Conversation.model.js';
import { extractionQueue, embeddingQueue, cacheQueue, summaryQueue, QUEUE_PREFIX } from '../queues/document.queue.js';

// Connect to MongoDB
await connectDB();

// Dedicated connection for BullMQ Worker (no commandTimeout to allow long blocking pop)
const workerConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 30000,
});

/**
 * Cleans raw text extracted from PDFs and OCR.
 */
const cleanExtractedText = (text) => {
  if (!text) return '';
  return text
    // Fix hyphenated line breaks: "hyphen-\nated" → "hyphenated"
    .replace(/-\n(\w)/g, '$1')
    // Collapse multiple blank lines to a maximum of 2 (paragraph separator)
    .replace(/\n{3,}/g, '\n\n')
    // Remove null bytes and non-printable control characters (except \n and \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse excessive spaces within lines (e.g. from PDF column layout)
    .replace(/[ \t]{3,}/g, '  ')
    // Remove trailing spaces from each line
    .replace(/[ \t]+\n/g, '\n')
    .trim();
};

/**
 * Helper: Publish progress state to Redis channel.
 */
const publishProgress = async (documentId, stage, status, extra = {}) => {
  try {
    const channel = `doc:progress:${documentId}`;
    const payload = JSON.stringify({
      documentId,
      stage,
      status,
      ...extra,
      timestamp: Date.now()
    });
    await workerConnection.publish(channel, payload);
    console.log(`[WORKER] Published progress to Redis [Channel: ${channel}]: ${stage} - ${status}`);
  } catch (err) {
    console.error(`[WORKER] Redis publish failed:`, err.message);
  }
};

/**
 * 1. Extraction Worker: Handles OCR, text extraction, semantic chunking, and AI summary.
 * Marks document as ready quickly and triggers embedding & caching background jobs.
 */
export const extractionWorker = new Worker(
  'document-extraction',
  async (job) => {
    const { documentId, fileKey, plan = 'free' } = job.data;
    console.log(`[WORKER: EXTRACTION] Job ${job.id} started for document: ${documentId}`);

    try {
      // 1. Atomic status transition: pending -> processing
      const doc = await Document.findOneAndUpdate(
        { _id: documentId, processingStatus: 'pending' },
        { processingStatus: 'processing', processingStage: 'file_received' },
        { returnDocument: 'after' }
      );

      if (!doc) {
        console.log(`[WORKER: EXTRACTION] Document ${documentId} already processing or completed. Skipping.`);
        return { success: false, reason: 'Already processed or invalid state' };
      }

      await publishProgress(documentId, 'file_received', 'processing');

      // 2. Extract content
      await Document.findByIdAndUpdate(documentId, { processingStage: 'extracting_content' });
      await publishProgress(documentId, 'extracting_content', 'processing');

      // Heartbeat during R2 download.
      // For larger files this download can take several seconds. Without a heartbeat
      // the progress bar freezes at 'extracting_content' with no visible movement.
      const downloadHeartbeat = setInterval(() => {
        publishProgress(documentId, 'extracting_content', 'processing', { heartbeat: true }).catch(() => {});
      }, 4000);

      let fileBuffer;
      try {
        fileBuffer = await StorageService.downloadFromR2(fileKey);
      } finally {
        clearInterval(downloadHeartbeat);
      }

      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Check if there is an existing fully processed document with this hash
      const existingDoc = await Document.findOne({
        fileHash,
        processingStatus: 'ready',
        knowledgeCacheStatus: 'ready'
      });

      if (existingDoc) {
        console.log(`[WORKER: EXTRACTION] Found matching ready document cache for hash ${fileHash}. Copying cached understanding.`);
        await Document.findByIdAndUpdate(documentId, {
          fileHash,
          rawText: existingDoc.rawText,
          chunks: existingDoc.chunks,
          chunkEmbeddings: existingDoc.chunkEmbeddings,
          totalChunks: existingDoc.totalChunks,
          topics: existingDoc.topics,
          summary: existingDoc.summary,
          detailedSummary: existingDoc.detailedSummary,
          aiUnderstandingFailed: existingDoc.aiUnderstandingFailed,
          hasQuestions: existingDoc.hasQuestions,
          knowledgeCacheStatus: existingDoc.knowledgeCacheStatus,
          knowledgeCache: existingDoc.knowledgeCache,
          conceptMapStatus: existingDoc.conceptMapStatus,
          conceptMap: existingDoc.conceptMap,
          processingStatus: 'ready',
          processingStage: 'ready'
        });

        await publishProgress(documentId, 'ready', 'ready', {
          topics: existingDoc.topics,
          summary: existingDoc.summary
        });
        return { success: true, cached: true };
      }

      let extractedText = '';

      if (doc.type === 'pdf') {
        const parser = new PDFParse({ data: fileBuffer });
        const pdfData = await parser.getText();
        await parser.destroy();
        extractedText = pdfData.text;

        // Check if the PDF has almost no text (scanned PDF / photos of handwritten notes)
        const cleanText = cleanExtractedText(extractedText);
        // Use text density to reliably catch large scanned PDFs (where only page numbers are extracted)
        const textDensity = cleanText ? (cleanText.length / pdfData.numpages) : 0;

        if (!cleanText || textDensity < 100) {
          console.log(`[WORKER: EXTRACTION] PDF ${documentId} has low text density (${textDensity.toFixed(2)} chars/page). Detected as scanned document.`);
          
          try {
            console.log(`[WORKER: EXTRACTION] Attempting native PDF extraction via OpenRouter Gateway...`);
            extractedText = await AIService.extractPDFNative(fileBuffer, fileKey);
          } catch (nativeErr) {
            console.log(`[WORKER: EXTRACTION] Native PDF extraction unavailable or failed: ${nativeErr.message}. Falling back to Vision OCR images...`);
            
            const { pdfToPng } = await import('pdf-to-png-converter');
            const images = await pdfToPng(fileBuffer, {
              viewportScale: 1.5 // increase resolution slightly for cleaner Vision OCR readings
            });

            console.log(`[WORKER: EXTRACTION] Rendered ${images.length} PDF pages as PNG images.`);

            // Bug fix: was Promise.all — one page failure killed the entire document.
            // Now sequential with per-page error recovery and rate-limit delay between pages.
            const pagesToProcess = images.slice(0, 10);
            console.log(`[WORKER: EXTRACTION] Processing ${pagesToProcess.length} pages sequentially...`);

            const pageTranscriptions = [];
            for (const [index, page] of pagesToProcess.entries()) {
              try {
                const pageBuffer = page.content;
                if (pageBuffer.length > 10 * 1024 * 1024) {
                  console.warn(`[WORKER: EXTRACTION] Page ${index + 1} exceeds 10MB limit. Skipping.`);
                  pageTranscriptions.push(`--- PAGE ${index + 1} ---\n[Page too large to process]`);
                  continue;
                }
                const base64 = pageBuffer.toString('base64');
                const pageText = await AIService.transcribeImage(base64, 'image/png');
                pageTranscriptions.push(`--- PAGE ${index + 1} ---\n${pageText}`);
                // Publish per-page progress so the bar visibly moves during OCR
                publishProgress(documentId, 'extracting_content', 'processing', {
                  heartbeat: true,
                  pagesDone: index + 1,
                  pagesTotal: pagesToProcess.length,
                }).catch(() => {});
              } catch (pageErr) {
                console.warn(`[WORKER: EXTRACTION] Page ${index + 1} transcription failed, skipping:`, pageErr.message);
                pageTranscriptions.push(`--- PAGE ${index + 1} ---\n[Page could not be transcribed]`);
              }
              // Pause between pages to avoid vision API rate limits
              if (index < pagesToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }

            extractedText = pageTranscriptions.join('\n\n');
          }
        }
      } else {
        if (fileBuffer.length > 10 * 1024 * 1024) {
          throw new Error('Image notes exceed the 10MB vision processing limit');
        }
        const base64 = fileBuffer.toString('base64');
        const extension = fileKey.split('.').pop().toLowerCase();
        let mimeType = 'image/jpeg';
        if (extension === 'png') mimeType = 'image/png';
        else if (extension === 'webp') mimeType = 'image/webp';

        extractedText = await AIService.transcribeImage(base64, mimeType);
      }

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Failed to extract text from document');
      }

      extractedText = cleanExtractedText(extractedText);

      // 3. Chunk text
      await Document.findByIdAndUpdate(documentId, { processingStage: 'identifying_concepts' });
      await publishProgress(documentId, 'identifying_concepts', 'processing');

      const chunks = splitIntoChunks(extractedText);

      // 4. Topic extraction & summary
      await Document.findByIdAndUpdate(documentId, { processingStage: 'building_learning_map' });
      await publishProgress(documentId, 'building_learning_map', 'processing');

      // ROOT CAUSE OF "STUCK AT 55%" BUG:
      // callGroqWithRetry reads the entire document, builds a comprehension prompt,
      // and waits for the LLM to return topics + a summary. For a dense 20-page PDF
      // this single call can take anywhere from 15 to 90 seconds depending on document
      // size and provider load. During that entire wait, nothing is published to Redis,
      // so the frontend progress bar appears completely frozen at 55%.
      //
      // Fix: fire a heartbeat to Redis every 7 seconds during the AI call so the
      // frontend knows work is actively happening even though the stage hasn't changed.
      const aiHeartbeat = setInterval(() => {
        publishProgress(documentId, 'building_learning_map', 'processing', { heartbeat: true }).catch(() => {});
      }, 7000);

      let topics = [];
      let summary = '';

      try {
        const understandingPrompt = buildDocumentUnderstandingPrompt(chunks);

        // Use the FAST model (8B instant) for topic/summary extraction, NOT the smart 70B model.
        // This task is structured JSON extraction from sampled text — the 8B model handles
        // it just as well. Switching saves 20-90 seconds per upload (the primary cause of
        // the stuck progress bar). The 70B smart model is reserved for actual tutoring.
        const aiResponse = await AIService.callGroqWithRetry(
          [{ role: 'user', content: understandingPrompt }],
          GROQ_MODELS.fast
        );

        const understanding = parseAIJson(aiResponse, { topics: [], summary: '' });
        topics = Array.isArray(understanding.topics) ? understanding.topics : [];
        summary = typeof understanding.summary === 'string' ? understanding.summary : '';
      } catch (aiErr) {
        console.error(`[WORKER: EXTRACTION] AI understanding failed for ${documentId}:`, aiErr.message);
        await Document.findByIdAndUpdate(documentId, { aiUnderstandingFailed: true });
      } finally {
        // Always stop the heartbeat whether the AI call succeeded or failed
        clearInterval(aiHeartbeat);
      }

      // 5. Detect whether the document contains questions/exam problems (zero AI cost)
      const hasQuestions = detectQuestionsInDocument(chunks);

      // ROOT CAUSE OF "BAR JUMPS FROM 55% STRAIGHT TO 100%" BUG:
      // The 'preparing_tutor' stage (which the frontend expects at ~75%) was defined
      // in the Document model but was NEVER emitted by the extraction worker.
      // It was only emitted by the cache worker — which runs after the document is
      // already marked ready, so the frontend had often already navigated away.
      // Without this stage the bar jumped: 55% frozen → silence → sudden 100%.
      await Document.findByIdAndUpdate(documentId, { processingStage: 'preparing_tutor' });
      await publishProgress(documentId, 'preparing_tutor', 'processing');

      // 6. Mark document as READY. The user can now view it and start study chats immediately!
      await Document.findByIdAndUpdate(documentId, {
        rawText: extractedText,
        chunks,
        totalChunks: chunks.length,
        topics,
        summary,
        fileHash,
        hasQuestions,
        misconceptions: [],
        processingStatus: 'ready',
        processingStage: 'ready',
        knowledgeCacheStatus: 'pending'
      });

      await publishProgress(documentId, 'ready', 'ready', { topics, summary });

      // 6. Queue Stage B and C as independent, parallel non-blocking background jobs
      console.log(`[WORKER: EXTRACTION] Document ${documentId} is READY. Queuing embeddings and cache generation...`);
      
      await embeddingQueue.add('generate-embeddings', { documentId, chunks }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        timeout: 300000 // 5 minutes
      });

      await cacheQueue.add('build-knowledge-cache', { documentId, chunks }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: 300000 // 5 minutes
      });

      return { success: true, status: 'ready', chunks: chunks.length };

    } catch (error) {
      console.error(`[WORKER: EXTRACTION] Error processing document ${documentId}:`, error);

      await Document.findByIdAndUpdate(documentId, {
        processingStatus: 'failed',
        processingStage: 'failed',
        'metadata.lastError': error.message
      });
      await publishProgress(documentId, 'failed', 'failed', { error: error.message });

      throw error;
    }
  },
  {
    connection: workerConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 4,
  }
);

/**
 * 2. Embeddings Worker: Handles chunk embedding generation.
 * Rate-limited using BullMQ's worker limiter to prevent OpenRouter/LLM provider 429 errors.
 */
export const embeddingWorker = new Worker(
  'document-embeddings',
  async (job) => {
    const { documentId, chunks } = job.data;
    console.log(`[WORKER: EMBEDDINGS] Job ${job.id} started for document: ${documentId}`);

    try {
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error(`Document ${documentId} not found for embedding generation`);
      }

      console.log(`[WORKER: EMBEDDINGS] Generating embeddings for ${chunks.length} chunks of document: ${documentId}`);

      const chunkEmbeddings = [];
      const BATCH_SIZE = 20;

      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        
        if (i >= 800) {
          // Cap remote API calls at 800 chunks, falling back to local embeddings for the remainder
          const batchEmbs = batch.map(c => AIService.getLocalTfidfEmbedding(c));
          chunkEmbeddings.push(...batchEmbs);
          continue;
        }

        try {
          const batchEmbs = await AIService.generateEmbeddingsBatch(batch);
          chunkEmbeddings.push(...batchEmbs);
        } catch (batchErr) {
          console.warn(`[WORKER: EMBEDDINGS] Batch embedding failed at index ${i}, generating individually:`, batchErr.message);
          for (const chunk of batch) {
            try {
              const emb = await AIService.generateEmbedding(chunk).catch(() => AIService.getLocalTfidfEmbedding(chunk));
              chunkEmbeddings.push(emb);
            } catch (localErr) {
              chunkEmbeddings.push(new Array(1536).fill(0));
            }
          }
        }

        // Delay 300ms between batches to strictly avoid rate limiting (429) cascades
        if (i + BATCH_SIZE < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      await Document.findByIdAndUpdate(documentId, { chunkEmbeddings });
      console.log(`[WORKER: EMBEDDINGS] Completed embeddings for document: ${documentId}`);
      return { success: true, embeddingsCount: chunkEmbeddings.length };

    } catch (error) {
      console.error(`[WORKER: EMBEDDINGS] Error generating embeddings for document ${documentId}:`, error);
      throw error;
    }
  },
  {
    connection: workerConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 2,
    limiter: {
      max: 20,       // Max 20 embedding jobs per second across workers
      duration: 1000,
    },
  }
);

/**
 * 3. Cache Worker: Generates deep study materials (concepts, definitions, flashcards, quizzes).
 * Employs parallel prompt splitting to prevent Groq API 30s gateway timeouts.
 */
export const cacheWorker = new Worker(
  'document-cache',
  async (job) => {
    const { documentId, chunks } = job.data;
    console.log(`[WORKER: CACHE] Job ${job.id} started for document: ${documentId}`);

    try {
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error(`Document ${documentId} not found for knowledge cache generation`);
      }

      await Document.findByIdAndUpdate(documentId, { knowledgeCacheStatus: 'processing' });
      await publishProgress(documentId, 'preparing_tutor', 'processing_cache');

      console.log(`[WORKER: CACHE] Building split knowledge cache for document: ${documentId}`);

      let knowledgeCache = {
        concepts: [],
        definitions: [],
        learningObjectives: [],
        keyFacts: [],
        importantExamples: [],
        formulae: [],
        flashcards: [],
        questionBank: [],
        examTopics: []
      };
      let conceptMap = null;

      const promptA = buildKnowledgeCachePromptA(chunks);
      const promptB = buildKnowledgeCachePromptB(chunks);

      const [resA, resB] = await Promise.all([
        AIService.generateAIResponse({
          task: 'analysis',
          messages: [{ role: 'user', content: promptA }],
          temperature: 0.2,
          max_tokens: 2500
        }),
        AIService.generateAIResponse({
          task: 'analysis',
          messages: [{ role: 'user', content: promptB }],
          temperature: 0.2,
          max_tokens: 3500
        })
      ]);

      const parsedA = parseAIJson(resA, {});
      const parsedB = parseAIJson(resB, {});

      knowledgeCache = {
        concepts: Array.isArray(parsedA.concepts) ? parsedA.concepts : [],
        definitions: Array.isArray(parsedA.definitions) ? parsedA.definitions : [],
        learningObjectives: Array.isArray(parsedA.learningObjectives) ? parsedA.learningObjectives : [],
        keyFacts: Array.isArray(parsedA.keyFacts) ? parsedA.keyFacts : [],
        importantExamples: Array.isArray(parsedA.importantExamples) ? parsedA.importantExamples : [],
        formulae: Array.isArray(parsedB.formulae) ? parsedB.formulae : [],
        flashcards: Array.isArray(parsedB.flashcards) ? parsedB.flashcards : [],
        questionBank: Array.isArray(parsedB.questionBank) ? parsedB.questionBank : [],
        examTopics: Array.isArray(parsedA.examTopics) ? parsedA.examTopics : []
      };

      conceptMap = parsedB.conceptMap || null;

      // Bug fix: conceptMapStatus was never set to 'ready', so getDocumentConceptMap
      // always bypassed the cache and re-generated it on every request.
      const cacheUpdate = {
        knowledgeCache,
        knowledgeCacheStatus: 'ready',
      };
      if (conceptMap) {
        cacheUpdate.conceptMap = conceptMap;
        cacheUpdate.conceptMapStatus = 'ready';
      }

      await Document.findByIdAndUpdate(documentId, cacheUpdate);

      await publishProgress(documentId, 'ready', 'ready_cache');
      console.log(`[WORKER: CACHE] Completed knowledge cache for document: ${documentId}`);
      return { success: true };

    } catch (error) {
      console.error(`[WORKER: CACHE] Master cache generation failed:`, error.message);
      await Document.findByIdAndUpdate(documentId, { knowledgeCacheStatus: 'failed' });
      await publishProgress(documentId, 'ready', 'failed_cache');
      throw error;
    }
  },
  {
    connection: workerConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 2,
  }
);

// Worker failure events reporting
extractionWorker.on('failed', async (job, err) => {
  console.error(`[WORKER: EXTRACTION] Job ${job?.id} failed permanently: ${err.message}`);
  try {
    await AppErrorLog.create({
      errorId: `err_worker_ext_${crypto.randomUUID().slice(0, 8)}`,
      message: err.message || 'Extraction worker failed',
      stack: err.stack,
      statusCode: 500,
      source: 'worker',
      route: 'worker:document-extraction',
      method: 'job',
      body: job?.data
    });
  } catch (logErr) {
    console.error('Failed to log worker failure to DB:', logErr.message);
  }
});

embeddingWorker.on('failed', async (job, err) => {
  console.error(`[WORKER: EMBEDDINGS] Job ${job?.id} failed permanently: ${err.message}`);
  try {
    await AppErrorLog.create({
      errorId: `err_worker_emb_${crypto.randomUUID().slice(0, 8)}`,
      message: err.message || 'Embedding worker failed',
      stack: err.stack,
      statusCode: 500,
      source: 'worker',
      route: 'worker:document-embeddings',
      method: 'job',
      body: job?.data
    });
  } catch (logErr) {
    console.error('Failed to log worker failure to DB:', logErr.message);
  }
});

cacheWorker.on('failed', async (job, err) => {
  console.error(`[WORKER: CACHE] Job ${job?.id} failed permanently: ${err.message}`);
  try {
    await AppErrorLog.create({
      errorId: `err_worker_cache_${crypto.randomUUID().slice(0, 8)}`,
      message: err.message || 'Cache worker failed',
      stack: err.stack,
      statusCode: 500,
      source: 'worker',
      route: 'worker:document-cache',
      method: 'job',
      body: job?.data
    });
  } catch (logErr) {
    console.error('Failed to log worker failure to DB:', logErr.message);
  }
});

export const summaryWorker = new Worker(
  'session-summary',
  async (job) => {
    const { conversationId, priorSummary, candidateMessages } = job.data;
    console.log(`[WORKER: SUMMARY] Job ${job.id} started for conversation: ${conversationId}`);

    try {
      const formattedHistory = candidateMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

      const systemPrompt = 
        "You are a conversation memory consolidator. Read the prior summary and the new chat history segments between a student and an AI tutor.\n" +
        "Generate a consolidated, updated summary of the discussion. Focus on explained concepts, key details, student's preferences, goals, and any student difficulties or weaknesses.\n" +
        "Keep the summary concise (under 150 words). Return ONLY the new raw summary text.";

      const userPrompt = 
        `PRIOR SUMMARY: ${priorSummary || 'None'}\n\n` +
        `NEW CONVERSATION SEGMENT:\n${formattedHistory}`;

      const rawSummary = await AIService.generateAIResponse({
        task: 'analysis',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });

      const cleanSummary = rawSummary.trim();
      if (cleanSummary && cleanSummary.length > 10) {
        await Conversation.updateOne(
          { _id: conversationId },
          { $set: { summaryMemory: cleanSummary } }
        );
        console.log(`[WORKER: SUMMARY] Conversation ${conversationId} summarized. Length: ${cleanSummary.length} chars.`);
      }
      return { success: true };
    } catch (err) {
      console.error(`[WORKER: SUMMARY] Summarization job failed:`, err.message);
      throw err;
    }
  },
  {
    connection: workerConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  }
);

summaryWorker.on('failed', async (job, err) => {
  console.error(`[WORKER: SUMMARY] Job ${job?.id} failed permanently: ${err.message}`);
  try {
    await AppErrorLog.create({
      errorId: `err_worker_sum_${crypto.randomUUID().slice(0, 8)}`,
      message: err.message || 'Summary worker failed',
      stack: err.stack,
      statusCode: 500,
      source: 'worker',
      route: 'worker:session-summary',
      method: 'job',
      body: job?.data
    });
  } catch (logErr) {
    console.error('Failed to log worker failure to DB:', logErr.message);
  }
});

export default {
  extractionWorker,
  embeddingWorker,
  cacheWorker,
  summaryWorker,
};
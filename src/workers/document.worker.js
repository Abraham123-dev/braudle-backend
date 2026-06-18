import { Worker } from 'bullmq';
import { redisClient } from '../config/redis.js';
import { connectDB } from '../config/db.js';
import Document from '../models/Document.model.js';
import * as StorageService from '../services/storage.service.js';
import { splitIntoChunks } from '../utils/chunker.js';
import { buildDocumentUnderstandingPrompt } from '../utils/promptBuilder.js';
import { PDFParse } from 'pdf-parse';
import * as AIService from '../services/ai.service.js';
import { GROQ_MODELS } from '../config/models.js';
import { parseAIJson } from '../utils/parseAIJson.js';

// Connect to MongoDB
await connectDB();


/**
 * Helper: Update a single stage field atomically.
 * Keeps stage transitions readable and prevents partial state.
 */
const setStage = (documentId, stage) =>
  Document.findByIdAndUpdate(documentId, { processingStage: stage });

/**
 * The Document Worker processes background jobs for file extraction and AI understanding.
 * It walks the document through 6 named stages so the frontend can display rich progress.
 *
 * Stages:
 *   1. file_received       — Job picked up, starting
 *   2. extracting_content  — Downloading from R2, parsing PDF/image
 *   3. identifying_concepts — Chunking extracted text
 *   4. building_learning_map — Sending to AI for topic + summary extraction
 *   5. preparing_tutor     — Saving all data to MongoDB
 *   6. ready               — Complete. AI tutor is armed.
 */
const documentWorker = new Worker(
  'document-processing',
  async (job) => {
    const { documentId, fileKey } = job.data;

    console.log(`[WORKER] Processing document: ${documentId}`);

    try {
      // ── Stage 1 ─────────────────────────────────────────────────────────────
      // Atomic status transition: pending -> processing
      // If this fails, the document was already picked up by another worker instance.
      const doc = await Document.findOneAndUpdate(
        { _id: documentId, processingStatus: 'pending' },
        { processingStatus: 'processing', processingStage: 'file_received' },
        { new: true }
      );

      if (!doc) {
        console.log(`[WORKER] Document ${documentId} already processing or completed. Skipping.`);
        return { success: false, reason: 'Already processed or invalid state' };
      }

      // ── Stage 2 ─────────────────────────────────────────────────────────────
      await setStage(documentId, 'extracting_content');

      const fileBuffer = await StorageService.downloadFromR2(fileKey);

      let extractedText = '';

      if (doc.type === 'pdf') {
        const parser = new PDFParse({ data: fileBuffer });
        const data = await parser.getText();
        extractedText = data.text;
        await parser.destroy();
      } else {
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

      // ── Stage 3 ─────────────────────────────────────────────────────────────
      await setStage(documentId, 'identifying_concepts');

      const chunks = splitIntoChunks(extractedText);

      // ── Stage 4 ─────────────────────────────────────────────────────────────
      // AI Document Understanding: Extract topics and a student-facing summary.
      // This is what transforms the document from a file into a learning resource.
      await setStage(documentId, 'building_learning_map');

      let topics = [];
      let summary = '';

      try {
        const understandingPrompt = buildDocumentUnderstandingPrompt(chunks);
        const aiResponse = await AIService.callGroqWithRetry(
          [{ role: 'user', content: understandingPrompt }],
          GROQ_MODELS.fast
        );

        const understanding = parseAIJson(aiResponse, { topics: [], summary: '' });

        topics = Array.isArray(understanding.topics) ? understanding.topics : [];
        summary = typeof understanding.summary === 'string' ? understanding.summary : '';
      } catch (aiErr) {
        // Non-fatal: If AI understanding fails, the document is still usable for teaching.
        // Log the error but continue — chunks are still valid for the tutor.
        console.error(`[WORKER] AI understanding failed for ${documentId}:`, aiErr.message);
        // Mark in DB so the frontend knows the summary/topics section may be empty
        await Document.findByIdAndUpdate(documentId, { aiUnderstandingFailed: true });
      }

      // ── Stage 5 ─────────────────────────────────────────────────────────────
      // Signal to the frontend that we are arming the tutor (final save incoming)
      await setStage(documentId, 'preparing_tutor');

      // ── Stage 6 ─────────────────────────────────────────────────────────────
      await Document.findByIdAndUpdate(documentId, {
        rawText: extractedText,
        chunks,
        totalChunks: chunks.length,
        topics,
        summary,
        misconceptions: [],
        processingStatus: 'ready',
        processingStage: 'ready',
      });

      // ── Done ────────────────────────────────────────────────────────────────
      console.log(`[WORKER] Successfully processed document: ${documentId} | Topics: ${topics.join(', ')}`);
      return { success: true, chunks: chunks.length, topics };

    } catch (error) {
      console.error(`[WORKER] Error processing document ${documentId}:`, error);

      await Document.findByIdAndUpdate(documentId, {
        processingStatus: 'failed',
        processingStage: 'failed',
        'metadata.lastError': error.message
      });

      throw error; // Let BullMQ handle retry logic
    }
  },
  {
    connection: redisClient,
    concurrency: 2,
  }
);

documentWorker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job.id} failed permanently: ${err.message}`);
});

export default documentWorker;
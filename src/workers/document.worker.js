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
 * Cleans raw text extracted from PDFs and OCR.
 * PDFs frequently produce: hyphenated line-breaks ("com-\nputer"), excessive whitespace,
 * null bytes, and ligature artifacts. Fixing these before chunking produces much better
 * AI context windows and improves quiz/topic quality significantly.
 *
 * @param {string} text - Raw extracted text
 * @returns {string} Cleaned text
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

      // Clean raw text: fix PDF layout artifacts, hyphenation, excessive whitespace
      extractedText = cleanExtractedText(extractedText);

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
    // Increased from 2 → 4: each job is I/O-bound (R2 download + Groq API), not CPU-bound.
    // Higher concurrency improves throughput for concurrent uploads without overloading.
    concurrency: 4,
  }
);

documentWorker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job.id} failed permanently: ${err.message}`);
});

export default documentWorker;
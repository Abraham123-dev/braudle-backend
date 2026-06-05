import { Worker } from 'bullmq';
import { redisClient } from '../config/redis.js';
import Document from '../models/Document.model.js';
import * as StorageService from '../services/storage.service.js';
import { splitIntoChunks } from '../utils/chunker.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import * as AIService from '../services/ai.service.js';

/**
 * The Document Worker processes background jobs for file extraction.
 * It separates heavy I/O and CPU tasks from the main API thread.
 */
const documentWorker = new Worker(
  'document-processing',
  async (job) => {
    const { documentId, fileKey } = job.data;
    
    console.log(`[WORKER] Processing document: ${documentId}`);

    try {
      // 1. Atomic status transition: pending -> processing
      // This ensures idempotency and prevents duplicate processing across workers.
      const doc = await Document.findOneAndUpdate(
        { _id: documentId, processingStatus: 'pending' },
        { processingStatus: 'processing' },
        { new: true }
      );

      if (!doc) {
        console.log(`[WORKER] Document ${documentId} is already being processed or completed. Skipping.`);
        return { success: false, reason: 'Already processed or invalid state' };
      }

      // 2. Download buffer from R2
      const fileBuffer = await StorageService.downloadFromR2(fileKey);

      let extractedText = '';

      if (doc.type === 'pdf') {
        const data = await pdf(fileBuffer);
        extractedText = data.text;
      } else {
        const base64 = fileBuffer.toString('base64');
        extractedText = await AIService.transcribeImage(base64);
      }

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Failed to extract text from document');
      }

      // 4. Create semantic chunks
      const chunks = splitIntoChunks(extractedText);

      // 5. Update Document with final data
      await Document.findByIdAndUpdate(documentId, {
        rawText: extractedText,
        chunks: chunks,
        totalChunks: chunks.length,
        processingStatus: 'ready'
      });

      console.log(`[WORKER] Successfully processed document: ${documentId}`);
      return { success: true, chunks: chunks.length };
      
    } catch (error) {
      console.error(`[WORKER] Error processing document ${documentId}:`, error);
      
      await Document.findByIdAndUpdate(documentId, { 
        processingStatus: 'failed' 
      });
      
      throw error; // Let BullMQ handle the retry logic
    }
  },
  {
    connection: redisClient,
    concurrency: 2, // Process 2 documents at a time
  }
);

documentWorker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job.id} failed permanently: ${err.message}`);
});

export default documentWorker;
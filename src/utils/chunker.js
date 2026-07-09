import { generateEmbeddingsBatch } from '../services/ai.service.js';

// Helper: Cosine similarity
const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const getWordCount = (str) => str.split(/\s+/).filter(Boolean).length;

// Splits text into chunks for AI processing
// Note: Updated to word-based chunking for more stable AI context windows.
// Target: ~400 words per chunk.
const splitIntoChunks = (text, wordLimit = 300) => {
  if (!text || text.length === 0) return [];
  
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;

  for (const para of paragraphs) {
    const paraWordCount = getWordCount(para);

    // If paragraph fits, add it to current chunk
    if (currentWordCount + paraWordCount <= wordLimit) {
      currentChunk.push(para);
      currentWordCount += paraWordCount;
      continue;
    }

    // It doesn't fit. Save current chunk if not empty
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentWordCount = 0;
    }

    // If the paragraph itself is larger than the limit, split it by sentences
    if (paraWordCount > wordLimit) {
      // Split by sentence boundaries (.?! followed by whitespace)
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentenceChunk = [];
      let sentenceWordCount = 0;

      for (const sentence of sentences) {
        const sentenceWords = getWordCount(sentence);

        if (sentenceWordCount + sentenceWords <= wordLimit) {
          sentenceChunk.push(sentence);
          sentenceWordCount += sentenceWords;
        } else {
          if (sentenceChunk.length > 0) {
            chunks.push(sentenceChunk.join(' '));
          }

          // If a single sentence is somehow longer than wordLimit, chunk it by words
          if (sentenceWords > wordLimit) {
            const words = sentence.split(/\s+/);
            for (let i = 0; i < words.length; i += wordLimit) {
              chunks.push(words.slice(i, i + wordLimit).join(' '));
            }
            sentenceChunk = [];
            sentenceWordCount = 0;
          } else {
            sentenceChunk = [sentence];
            sentenceWordCount = sentenceWords;
          }
        }
      }

      if (sentenceChunk.length > 0) {
        currentChunk = [sentenceChunk.join(' ')];
        currentWordCount = sentenceWordCount;
      }
    } else {
      // Paragraph fits in a new chunk
      currentChunk = [para];
      currentWordCount = paraWordCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
};

/**
 * Splits text into chunks semantically by grouping sentences with high cosine similarity.
 *
 * @param {string} text - Raw input text
 * @param {object} options - Configuration overrides
 * @returns {Promise<string[]>} Semantically split text chunks
 */
const splitIntoChunksSemantic = async (text, options = {}) => {
  const {
    targetWords = 350,
    minSentences = 2,
    similarityThreshold = 0.30
  } = options;

  if (!text || text.trim().length === 0) return [];

  // 1. Split into raw sentences
  const rawSentences = text.split(/(?<=[.!?])\s+/);
  const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
  if (sentences.length <= minSentences) {
    return [text];
  }

  // 2. Fetch sentence embeddings in batch (capped at 100 sentences per call to avoid payload sizes and API timeouts)
  const embeddings = [];
  const BATCH_SIZE = 100;
  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    const batch = sentences.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await generateEmbeddingsBatch(batch);
    embeddings.push(...batchEmbeddings);
  }

  // 3. Compute similarity differences between consecutive sentences
  const similarities = [];
  for (let i = 0; i < sentences.length - 1; i++) {
    similarities.push(cosineSimilarity(embeddings[i], embeddings[i + 1]));
  }

  // 4. Group sentences into coherent chunks
  const chunks = [];
  let currentChunk = [sentences[0]];
  let currentWords = getWordCount(sentences[0]);

  for (let i = 0; i < similarities.length; i++) {
    const nextSentence = sentences[i + 1];
    const nextWords = getWordCount(nextSentence);
    const similarity = similarities[i];

    // Determine boundaries based on topic changes or size limits
    const isTopicShift = similarity < similarityThreshold;
    const isOverLimit = currentWords + nextWords > targetWords;

    if ((isTopicShift && currentChunk.length >= minSentences) || 
        (isOverLimit && currentChunk.length >= minSentences)) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [nextSentence];
      currentWords = nextWords;
    } else {
      currentChunk.push(nextSentence);
      currentWords += nextWords;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
};

export { splitIntoChunks, splitIntoChunksSemantic };

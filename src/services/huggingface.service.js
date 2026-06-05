import { HfInference } from '@huggingface/inference';
import { env } from '../config/env.js';
import { HF_MODELS } from '../config/models.js';

const hf = new HfInference(env.huggingface.apiKey);

const SIMILARITY_THRESHOLD = {
  CORRECT: 0.85,
  PARTIAL: 0.60,
};

/**
 * Compares student answer to correct answer using semantic embeddings.
 * Returns 'correct', 'partial', or 'wrong'.
 */
export const checkAnswerSimilarity = async (studentAnswer, correctAnswer) => {
  const result = await hf.sentenceSimilarity({
    model: HF_MODELS.embeddings,
    inputs: {
      source_sentence: correctAnswer,
      sentences: [studentAnswer],
    },
  });

  const score = result[0];
  if (score >= SIMILARITY_THRESHOLD.CORRECT) return 'correct';
  if (score >= SIMILARITY_THRESHOLD.PARTIAL) return 'partial';
  return 'wrong';
};

/**
 * Categorizes student input into predefined labels using Zero-Shot Classification.
 */
export const classifyIntent = async (text, labels = ['question', 'answer', 'confusion', 'greeting']) => {
  const result = await hf.zeroShotClassification({
    model: HF_MODELS.classification,
    inputs: text,
    parameters: { candidate_labels: labels },
  });
  return result.labels[0];
};
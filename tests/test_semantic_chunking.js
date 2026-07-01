/**
 * Test: Semantic Chunker Utility
 * Verifies that the semantic chunker correctly groups sentences of similar topics
 * and splits them when a topic transition occurs.
 */

import dotenv from 'dotenv';
dotenv.config();

import { splitIntoChunksSemantic } from '../src/utils/chunker.js';
import * as AIService from '../src/services/ai.service.js';

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

let passed = 0;
let failed = 0;

function assert(description, condition, extra = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ' | ' + extra : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n── Running Semantic Chunker Tests ──');

  // Sample text with two highly distinct topics: Biology (Photosynthesis) vs. History (French Revolution)
  const sampleText = `Photosynthesis is a process used by plants and other organisms to convert light energy into chemical energy. This light energy is captured by chlorophyll molecules inside the chloroplasts of plant cells. The chemical energy is stored in carbohydrate molecules, such as sugars, which are synthesized from carbon dioxide and water. Oxygen is released as a waste product of this biological reaction.

Separately, the French Revolution was a period of radical political and societal change in France. It began with the Storming of the Bastille in 1789 and led to the overthrow of the monarchy. The revolution abolished the feudal system and drafted the Declaration of the Rights of Man and of the Citizen. Napoleon Bonaparte eventually rose to power, bringing an end to the revolutionary era.`;

  try {
    console.log('Testing semantic boundary separation...');
    
    // We'll calculate similarities directly in the test to inspect them
    const rawSentences = sampleText.split(/(?<=[.!?])\s+/);
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
    const embeddings = await AIService.generateEmbeddingsBatch(sentences);
    
    console.log('\n--- Adjacent Sentence Similarities ---');
    for (let i = 0; i < sentences.length - 1; i++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[i+1]);
      console.log(`Sentence ${i+1} <-> ${i+2} Similarity: ${sim.toFixed(4)}`);
      console.log(`  S${i+1}: "${sentences[i].substring(0, 40)}..."`);
      console.log(`  S${i+2}: "${sentences[i+1].substring(0, 40)}..."`);
    }
    console.log('-------------------------------------\n');

    const chunks = await splitIntoChunksSemantic(sampleText, {
      targetWords: 300,
      minSentences: 2,
      similarityThreshold: 0.30 // Try a lower threshold
    });

    console.log(`Generated ${chunks.length} chunks.`);
    chunks.forEach((chunk, i) => {
      console.log(`\n[Chunk ${i + 1}]:\n${chunk}`);
    });

    assert('Correct number of chunks created (should split into 2 distinct topics)', chunks.length === 2, `got ${chunks.length}`);
    
    if (chunks.length === 2) {
      assert('Chunk 1 covers photosynthesis', chunks[0].includes('Photosynthesis') && !chunks[0].includes('Napoleon'));
      assert('Chunk 2 covers French Revolution', chunks[1].includes('French Revolution') && !chunks[1].includes('chlorophyll'));
    }

    // Edge Cases
    console.log('\n── Edge Cases ──');
    const emptyResult = await splitIntoChunksSemantic('');
    assert('Empty string → []', JSON.stringify(emptyResult) === '[]');

    const singleSentence = 'This is a single sentence document.';
    const singleResult = await splitIntoChunksSemantic(singleSentence);
    assert('Single sentence → 1 chunk', singleResult.length === 1 && singleResult[0] === singleSentence);

  } catch (err) {
    console.error('Test execution failed:', err);
    failed++;
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

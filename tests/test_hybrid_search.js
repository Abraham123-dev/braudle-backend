/**
 * Test: Hybrid Search & Reciprocal Rank Fusion (RRF)
 * Verifies that RRF successfully combines semantic (vector) scores and lexical (keyword) scores.
 */

import dotenv from 'dotenv';
dotenv.config();

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

// 1. Cosine similarity helper
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

// 2. Lexical keyword matching helper
const calculateKeywordScore = (query, chunkText) => {
  const queryWords = query.toLowerCase().match(/\w+/g) || [];
  const chunkWords = chunkText.toLowerCase().match(/\w+/g) || [];
  if (queryWords.length === 0 || chunkWords.length === 0) return 0;
  
  let score = 0;
  queryWords.forEach(word => {
    const count = chunkWords.filter(w => w === word).length;
    if (count > 0) {
      score += (count / chunkWords.length);
    }
  });
  return score;
};

// 3. RRF Rank merger
const mergeRanksRRF = (vectorRanked, keywordRanked, chunksCount) => {
  const k = 60;
  const rrfScores = new Map();

  vectorRanked.forEach((item, rank) => {
    const currentScore = rrfScores.get(item.index) || 0;
    rrfScores.set(item.index, currentScore + 1 / (k + rank + 1));
  });

  keywordRanked.forEach((item, rank) => {
    const currentScore = rrfScores.get(item.index) || 0;
    rrfScores.set(item.index, currentScore + 1 / (k + rank + 1));
  });

  const finalRRFList = [];
  for (let i = 0; i < chunksCount; i++) {
    finalRRFList.push({
      index: i,
      rrfScore: rrfScores.get(i) || 0
    });
  }
  finalRRFList.sort((a, b) => b.rrfScore - a.rrfScore);
  return finalRRFList;
};

async function runTests() {
  console.log('\n── Running Hybrid Search & RRF Unit Tests ──');

  const chunks = [
    "Photosynthesis produces glucose from sunlight using chlorophyll pigment inside leaves.", // Vector match (conceptually close to 'plant energy')
    "The code word is ZANZIBAR.", // Keyword match (contains the unique term 'ZANZIBAR')
    "Napoleon Bonaparte was a French military leader who rose during the French Revolution." // Completely irrelevant
  ];

  // Mock query embedding (1536 dimensions)
  const mockQueryEmbedding = new Array(1536).fill(0);
  mockQueryEmbedding[0] = 1.0;
  mockQueryEmbedding[1] = 0.5;
  
  const mockEmbeddings = [
    new Array(1536).fill(0),
    new Array(1536).fill(0),
    new Array(1536).fill(0)
  ];
  mockEmbeddings[0][0] = 0.9;
  mockEmbeddings[0][1] = 0.45; // Close to query ratio
  mockEmbeddings[1][2] = 1.0;  // Orthogonal to query
  mockEmbeddings[2][3] = 1.0;  // Orthogonal to query

  const message = "Tell me about ZANZIBAR plant energy";

  // 1. Get Vector Rankings
  const vectorRanked = [];
  for (let i = 0; i < chunks.length; i++) {
    const score = cosineSimilarity(mockQueryEmbedding, mockEmbeddings[i]);
    vectorRanked.push({ index: i, score });
  }
  vectorRanked.sort((a, b) => b.score - a.score);

  console.log('Vector Scores:', vectorRanked);
  assert('Vector Rank 1 is Chunk 0 (conceptual match)', vectorRanked[0].index === 0);

  // 2. Get Keyword Rankings
  const keywordRanked = [];
  for (let i = 0; i < chunks.length; i++) {
    const score = calculateKeywordScore(message, chunks[i]);
    keywordRanked.push({ index: i, score });
  }
  keywordRanked.sort((a, b) => b.score - a.score);

  console.log('Keyword Scores:', keywordRanked);
  assert('Keyword Rank 1 is Chunk 1 (exact term match)', keywordRanked[0].index === 1);

  // 3. RRF Ranking
  const rrfList = mergeRanksRRF(vectorRanked, keywordRanked, chunks.length);
  console.log('RRF Merged Rankings:', rrfList);

  assert('RRF successfully prioritizes Chunk 1 & Chunk 0 over Chunk 2', rrfList[0].index !== 2 && rrfList[1].index !== 2);
  assert('RRF ranks Chunk 2 (completely irrelevant) last', rrfList[2].index === 2);

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

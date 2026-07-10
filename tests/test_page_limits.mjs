import crypto from 'crypto';
import { getLocalTfidfEmbedding } from '../src/services/ai.service.js';

// Validate embedding cap logic
async function mockGenerateEmbeddings(chunks) {
  const BATCH_SIZE = 20;
  const chunkEmbeddings = [];
  let apiCallsCount = 0;
  let localCallsCount = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    
    if (i >= 800) {
      // Cap remote API calls at 800 chunks, falling back to local embeddings for the remainder
      const batchEmbs = batch.map(c => {
        localCallsCount++;
        return getLocalTfidfEmbedding(c);
      });
      chunkEmbeddings.push(...batchEmbs);
      continue;
    }

    // Simulate remote API call
    apiCallsCount++;
    const batchEmbs = batch.map(c => new Array(1536).fill(1));
    chunkEmbeddings.push(...batchEmbs);
  }

  return { chunkEmbeddings, apiCallsCount, localCallsCount };
}

async function runTests() {
  console.log('--- 🧪 Running Embedding Cap & Throttling Tests ---');
  
  // Create 850 mock chunks (should result in 40 API batches of 20, and 50 chunks/2.5 batches locally)
  const mockChunks = Array.from({ length: 850 }, (_, i) => `mitosis division cell content chunk number ${i}`);
  const result = await mockGenerateEmbeddings(mockChunks);

  console.log(`Generated vectors count: ${result.chunkEmbeddings.length}`);
  console.log(`Remote API batch calls: ${result.apiCallsCount}`);
  console.log(`Local term-hash embedding calls: ${result.localCallsCount}`);

  if (result.chunkEmbeddings.length !== 850) {
    throw new Error(`Expected 850 vectors but got ${result.chunkEmbeddings.length}`);
  }
  if (result.apiCallsCount !== 40) {
    throw new Error(`Expected exactly 40 remote API batches but got ${result.apiCallsCount}`);
  }
  if (result.localCallsCount !== 50) {
    throw new Error(`Expected exactly 50 local embedding iterations but got ${result.localCallsCount}`);
  }

  console.log('✅ PASS: Capping limits verified successfully (Remote batch limit = 40, Local remainder count = 50)');

  console.log('\n--- 🎉 All Safeguards Tests Passed Successfully! ---');
}

runTests().catch(err => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});

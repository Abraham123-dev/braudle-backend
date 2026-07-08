import { generateEmbedding, generateEmbeddingsBatch } from '../src/services/ai.service.js';
import { env } from '../src/config/env.js';

async function run() {
  console.log('--- STARTING EMBEDDING FALLBACK TEST ---');

  const testText = 'Hello world, this is a test for secondary embedding fallbacks.';
  const testBatch = [
    'First chunk of text to embed.',
    'Second chunk of text for testing batch embeddings.',
    'Third short text.'
  ];

  const originalOpenRouterKey = env.openRouter.apiKey;
  const originalMistralKey = env.mistral.apiKey;

  // Case 1: Primary (OpenRouter) is enabled
  console.log('\nCase 1: Primary OpenRouter is enabled');
  try {
    const emb = await generateEmbedding(testText);
    console.log('Single embedding length:', emb.length);
    console.log('Is valid array:', Array.isArray(emb));
    console.log('First 5 values:', emb.slice(0, 5));

    const batchEmbs = await generateEmbeddingsBatch(testBatch);
    console.log('Batch embedding count:', batchEmbs.length);
    console.log('First batch item length:', batchEmbs[0]?.length);
  } catch (err) {
    console.error('Case 1 failed:', err);
  }

  // Case 2: OpenRouter disabled, Mistral enabled (Secondary Fallback)
  console.log('\nCase 2: OpenRouter disabled, Mistral enabled');
  env.openRouter.apiKey = ''; // disable OpenRouter
  try {
    const emb = await generateEmbedding(testText);
    console.log('Single embedding length (Mistral fallback):', emb.length);
    console.log('Is valid array:', Array.isArray(emb));
    console.log('First 5 values:', emb.slice(0, 5));
    // Verify padding: the last part of a padded 1024-dim vector should be zeros
    console.log('Padded tail check (index 1200):', emb[1200]);

    const batchEmbs = await generateEmbeddingsBatch(testBatch);
    console.log('Batch embedding count (Mistral fallback):', batchEmbs.length);
    console.log('First batch item length (Mistral fallback):', batchEmbs[0]?.length);
    console.log('Padded tail check for batch item (index 1200):', batchEmbs[0]?.[1200]);
  } catch (err) {
    console.error('Case 2 failed:', err);
  }

  // Case 3: Both OpenRouter and Mistral disabled (Local Fallback)
  console.log('\nCase 3: Both OpenRouter and Mistral disabled (Local Fallback)');
  env.mistral.apiKey = ''; // disable Mistral
  try {
    const emb = await generateEmbedding(testText);
    console.log('Single embedding length (Local fallback):', emb.length);
    console.log('Is valid array:', Array.isArray(emb));
    console.log('First 5 values:', emb.slice(0, 5));

    const batchEmbs = await generateEmbeddingsBatch(testBatch);
    console.log('Batch embedding count (Local fallback):', batchEmbs.length);
    console.log('First batch item length (Local fallback):', batchEmbs[0]?.length);
  } catch (err) {
    console.error('Case 3 failed:', err);
  }

  // Restore keys
  env.openRouter.apiKey = originalOpenRouterKey;
  env.mistral.apiKey = originalMistralKey;

  console.log('\n--- EMBEDDING FALLBACK TEST COMPLETED ---');
}

run();

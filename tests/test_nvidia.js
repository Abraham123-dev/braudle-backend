import dotenv from 'dotenv';
dotenv.config();

import { generateAIResponse, streamAIResponse } from '../src/services/ai.service.js';
import { env } from '../src/config/env.js';

async function testNvidiaNonStreaming() {
  console.log('\n--- Testing NVIDIA Non-Streaming (general_chat task) ---');
  
  // Back up original keys
  const origGroq = env.groq.apiKey;
  const origGroqSec = env.groqSecondary.apiKey;
  const origMistral = env.mistral.apiKey;
  const origOpenRouter = env.openRouter.apiKey;

  try {
    // Force fallback queue to bypass all prior models by clearing keys
    env.groq.apiKey = '';
    env.groqSecondary.apiKey = '';
    env.mistral.apiKey = '';
    env.openRouter.apiKey = '';

    console.log('Sending message to NVIDIA NIM...');
    const start = Date.now();
    const res = await generateAIResponse({
      task: 'general_chat',
      messages: [{ role: 'user', content: 'Say "NVIDIA fallback is working!" in exactly four words.' }]
    });
    console.log(`NVIDIA Response (${Date.now() - start}ms):`, res);
  } catch (err) {
    console.error('NVIDIA non-streaming test failed:', err);
  } finally {
    // Restore original keys
    env.groq.apiKey = origGroq;
    env.groqSecondary.apiKey = origGroqSec;
    env.mistral.apiKey = origMistral;
    env.openRouter.apiKey = origOpenRouter;
  }
}

async function testNvidiaStreaming() {
  console.log('\n--- Testing NVIDIA Streaming (tutoring task) ---');

  // Back up original keys
  const origGroq = env.groq.apiKey;
  const origGroqSec = env.groqSecondary.apiKey;
  const origMistral = env.mistral.apiKey;
  const origOpenRouter = env.openRouter.apiKey;

  try {
    // Force fallback queue to bypass all prior models by clearing keys
    env.groq.apiKey = '';
    env.groqSecondary.apiKey = '';
    env.mistral.apiKey = '';
    env.openRouter.apiKey = '';

    console.log('Streaming from NVIDIA NIM...');
    const start = Date.now();
    const stream = streamAIResponse({
      task: 'tutoring',
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }]
    });

    process.stdout.write('Streamed response: ');
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices?.[0]?.delta?.content || '');
    }
    console.log(`\nStreaming complete (${Date.now() - start}ms).`);
  } catch (err) {
    console.error('NVIDIA streaming test failed:', err);
  } finally {
    // Restore original keys
    env.groq.apiKey = origGroq;
    env.groqSecondary.apiKey = origGroqSec;
    env.mistral.apiKey = origMistral;
    env.openRouter.apiKey = origOpenRouter;
  }
}

async function run() {
  if (!env.nvidia.apiKey) {
    console.error('ERROR: NVIDIA_API_KEY is not defined in the environment.');
    process.exit(1);
  }
  await testNvidiaNonStreaming();
  await testNvidiaStreaming();
}

run();

import dotenv from 'dotenv';
dotenv.config();

import { generateAIResponse, streamAIResponse } from '../src/services/ai.service.js';

async function testNonStreaming() {
  console.log('--- Testing Non-Streaming (analysis task) ---');
  try {
    const res = await generateAIResponse({
      task: 'analysis',
      messages: [{ role: 'user', content: 'Say "Hello, Gateway!" in exactly three words.' }]
    });
    console.log('Response:', res);
  } catch (err) {
    console.error('Non-streaming test failed:', err);
  }
}

async function testStreaming() {
  console.log('--- Testing Streaming (tutoring task) ---');
  try {
    const stream = streamAIResponse({
      task: 'tutoring',
      messages: [{ role: 'user', content: 'Count from 1 to 3.' }]
    });
    process.stdout.write('Streamed response: ');
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices?.[0]?.delta?.content || '');
    }
    console.log('\nStreaming complete.');
  } catch (err) {
    console.error('Streaming test failed:', err);
  }
}

async function run() {
  await testNonStreaming();
  await testStreaming();
}

run();

import dotenv from 'dotenv';
dotenv.config();

import { transcribeImage } from '../src/services/ai.service.js';

async function testVision() {
  console.log('--- Testing Qwen Vision Model on Groq (2x2 pixel PNG) ---');
  // 2x2 transparent PNG base64
  const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYGD4DwEMDAz/gQAAAP//w8EB/AAAAABJRU5ErkJggg==';
  try {
    const res = await transcribeImage(mockBase64, 'image/png');
    console.log('Success! Response:', res);
  } catch (err) {
    console.error('Vision test failed:', err);
  }
}

testVision();

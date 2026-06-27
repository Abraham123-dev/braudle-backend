import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { transcribeImage } from '../src/services/ai.service.js';

async function testVision() {
  console.log('--- Testing Qwen Vision Model on Groq with Real Image ---');
  
  const imagePath = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\32f7683b-3662-4fb4-94ec-9d735d76cc74\\login_screen_1782406435055.png';
  
  if (!fs.existsSync(imagePath)) {
    console.error(`Error: File not found at ${imagePath}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  try {
    const res = await transcribeImage(base64Image, 'image/png');
    console.log('Success! Response:\n', res);
  } catch (err) {
    console.error('Vision test failed:', err);
  }
}

testVision();

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { transcribeImage } from '../src/services/ai.service.js';

async function analyzeScreenshot() {
  const imagePath = 'C:\\Users\\USER\\OneDrive\\Pictures\\Screenshots\\Screenshot 2026-01-16 132803.png';
  console.log(`Reading image from ${imagePath}...`);
  
  if (!fs.existsSync(imagePath)) {
    console.error('Error: File not found.');
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  console.log('Sending image to vision model for analysis...');
  try {
    const res = await transcribeImage(base64Image, 'image/png');
    console.log('\n--- VISION MODEL ANALYSIS ---');
    console.log(res);
  } catch (err) {
    console.error('Vision analysis failed:', err);
  }
}

analyzeScreenshot();

import dotenv from 'dotenv';
dotenv.config();

import Groq from 'groq-sdk';
import { env } from '../src/config/env.js';

const groq = new Groq({ apiKey: env.groq.apiKey });

async function testQwen() {
  const url = "https://pub-8212272583a64b0aac16436e85c484a1.r2.dev/general-chat/6a3eda2a0b22fa36ed79cc05/1782504993036-screenshot-2026-02-13-130131.png";
  console.log(`Fetching image from: ${url}`);
  
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch image: ${res.status}`);
    return;
  }
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  console.log(`Base64 length: ${base64.length}`);

  try {
    console.log('Sending vision completion request to Groq (Model: qwen/qwen3.6-27b)...');
    const completion = await groq.chat.completions.create({
      model: 'qwen/qwen3.6-27b',
      messages: [
        {
          role: 'system',
          content: 'You are a vision assistant. Output your analysis in JSON format.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this image' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }
      ]
    });
    console.log('--- RESPONSE CONTENT ---');
    console.log(completion.choices[0]?.message?.content);
  } catch (err) {
    console.error('Vision request failed:', err);
  }
}

testQwen();

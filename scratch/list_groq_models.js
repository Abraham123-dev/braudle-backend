import dotenv from 'dotenv';
dotenv.config();

import Groq from 'groq-sdk';
import { env } from '../src/config/env.js';

const groq = new Groq({ apiKey: env.groq.apiKey || process.env.GROQ_API_KEY_1 });

async function listModels() {
  try {
    const list = await groq.models.list();
    console.log('Available Groq Models:');
    list.data.forEach(m => {
      console.log(`- ${m.id} (owned by ${m.owned_by})`);
    });
  } catch (err) {
    console.error('Error listing models:', err);
  }
}

listModels();

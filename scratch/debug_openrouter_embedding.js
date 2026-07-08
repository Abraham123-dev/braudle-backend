import { env } from '../src/config/env.js';

async function test() {
  console.log('Testing OpenRouter Embeddings...');
  console.log('API Key exists:', !!env.openRouter.apiKey);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.openRouter.apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: 'Test string',
      }),
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    const body = await response.text();
    console.log('Body:', body);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();

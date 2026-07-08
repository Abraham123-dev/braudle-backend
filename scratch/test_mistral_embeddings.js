import { env } from '../src/config/env.js';

async function test() {
  console.log('Testing Mistral Embeddings...');
  console.log('API Key exists:', !!env.mistral.apiKey);
  try {
    const response = await fetch('https://api.mistral.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.mistral.apiKey}`,
      },
      body: JSON.stringify({
        model: 'mistral-embed',
        input: 'Test string',
      }),
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    const body = await response.json();
    console.log('Body keys:', Object.keys(body));
    if (body.data && body.data[0]) {
      console.log('Embedding length:', body.data[0].embedding.length);
    } else {
      console.log('Full body:', JSON.stringify(body, null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

test();

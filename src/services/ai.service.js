import Groq from 'groq-sdk';
import { env } from '../config/env.js';

const groq = new Groq({ apiKey: env.groq.apiKey });

/**
 * Streams chat completions from Groq using the high-performance Llama models.
 * Used primarily for real-time tutoring sessions via SSE.
 * 
 * @param {string} systemPrompt - The constructed persona and context
 * @param {string} userMessage - The latest message from the student
 * @param {Array} history - Recent conversation history for context
 */
export const streamGroq = async (systemPrompt, userMessage, history = []) => {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({ 
      role: msg.role, 
      content: msg.content 
    })),
    { role: 'user', content: userMessage },
  ];

  return groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile', // Smart model for high quality reasoning
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 1,
  });
};

/**
 * Performs a non-streaming call to Groq.
 * Useful for background tasks like quiz generation or content summarization.
 */
export const callGroq = async (messages, model = 'llama-3.3-70b-versatile') => {
  const completion = await groq.chat.completions.create({
    model,
    messages,
    temperature: 0.5,
    max_tokens: 2048,
  });

  return completion.choices[0]?.message?.content || '';
};

/**
 * Call Groq with basic exponential backoff for rate limits.
 */
export const callGroqWithRetry = async (messages, model = 'llama-3.3-70b-versatile', retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await callGroq(messages, model);
    } catch (err) {
      if (err.status === 429 && attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Groq rate limit exceeded after retries');
};
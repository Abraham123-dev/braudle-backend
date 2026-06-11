import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { GROQ_MODELS } from '../config/models.js';
import { buildSessionAnalysisPrompt } from '../utils/promptBuilder.js';
import { parseAIJson } from '../utils/parseAIJson.js';

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
    model: GROQ_MODELS.smart,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 1,
  });
};

/**
 * Transcribes handwritten text from an image using Groq Vision.
 */
export const transcribeImage = async (imageBase64) => {
  const response = await groq.chat.completions.create({
    model: GROQ_MODELS.vision,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe all handwritten text in this image accurately. Preserve headings and lists. Return only text.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content || '';
};

/**
 * Performs a non-streaming call to Groq.
 * Useful for background tasks like quiz generation or content summarization.
 */
export const callGroq = async (messages, model = GROQ_MODELS.smart) => {
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
export const callGroqWithRetry = async (messages, model = GROQ_MODELS.smart, retries = 3) => {
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

/**
 * Analyzes a completed session transcript to extract learning insights.
 * 
 * @param {Object[]} messages - The conversation history array.
 * @param {string[]} documentTopics - List of valid topics for the document.
 * @returns {Promise<Object>} Analysis object with weakTopics, strongTopics, and summary.
 */
export const analyzeSession = async (messages, documentTopics = []) => {
  const prompt = buildSessionAnalysisPrompt(messages, documentTopics);

  const response = await callGroqWithRetry(
    [{ role: 'user', content: prompt }],
    GROQ_MODELS.smart
  );

  const analysis = parseAIJson(response, { weakTopics: [], strongTopics: [], summary: '' });

  return {
    weakTopics: Array.isArray(analysis.weakTopics) ? analysis.weakTopics : [],
    strongTopics: Array.isArray(analysis.strongTopics) ? analysis.strongTopics : [],
    misconceptions: Array.isArray(analysis.misconceptions) ? analysis.misconceptions : [],
    summary: typeof analysis.summary === 'string' ? analysis.summary : ''
  };
};
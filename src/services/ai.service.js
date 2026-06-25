import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { GROQ_MODELS } from '../config/models.js';
import { buildSessionAnalysisPrompt } from '../utils/promptBuilder.js';
import { parseAIJson } from '../utils/parseAIJson.js';

const groq = new Groq({ apiKey: env.groq.apiKey, maxRetries: 0 });
const groqSecondary = new Groq({ apiKey: env.groqSecondary.apiKey, maxRetries: 0 });

/**
 * Normalizes provider error types to detect transient status codes.
 */
function isTransientError(error) {
  const status = error.status || error.statusCode || error.responseStatus;
  
  // Do not fallback on: 400 (Invalid Request), 401/403 (Authentication/API Key errors)
  if (status && [400, 401, 403].includes(status)) {
    return false;
  }

  const message = error.message ? error.message.toLowerCase() : '';
  const name = error.name ? error.name.toLowerCase() : '';

  // Explicit check to block API Key or Authentication issues from fallback
  if (
    message.includes('api key') ||
    message.includes('apikey') ||
    message.includes('auth') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid key') ||
    message.includes('validation')
  ) {
    return false;
  }

  if (status) {
    const transientStatuses = [413, 429, 500, 502, 503];
    return transientStatuses.includes(status);
  }

  if (
    message.includes('timeout') ||
    message.includes('etimedout') ||
    message.includes('abort') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connect') ||
    name.includes('abort') ||
    name.includes('timeout')
  ) {
    return true;
  }

  return false;
}

/**
 * Resolves model slugs to the actual API-compatible model IDs.
 */
const getModelForTask = (provider, task) => {
  const mapping = {
    groq: {
      tutoring: 'llama-3.3-70b-versatile',
      analysis: 'llama-3.1-8b-instant',
      vision: 'qwen/qwen3.6-27b',
      general_chat: 'llama-3.3-70b-versatile'
    },
    groq_secondary: {
      tutoring: 'llama-3.3-70b-versatile',
      analysis: 'llama-3.1-8b-instant',
      vision: 'qwen/qwen3.6-27b',
      general_chat: 'llama-3.3-70b-versatile'
    },
    openrouter: {
      tutoring: 'deepseek/deepseek-chat',
      analysis: 'qwen/qwen-2.5-32b-instruct',
      vision: 'qwen/qwen-2.5-vl-72b-instruct',
      general_chat: 'deepseek/deepseek-chat'
    },
    mistral: {
      tutoring: 'mistral-medium-latest',
      analysis: 'mistral-small-latest',
      vision: 'pixtral-large-latest',
      general_chat: 'mistral-small-latest'
    }
  };
  return mapping[provider]?.[task] || '';
};

/**
 * Maps task model IDs to their standard display names for logging.
 */
const getModelDisplayName = (modelSlug) => {
  const MODEL_DISPLAY_NAMES = {
    'llama-3.3-70b-versatile': 'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant': 'llama-3.1-8b-instant',
    'qwen/qwen3.6-27b': 'Qwen 3.6 27B Vision',
    'deepseek/deepseek-chat': 'DeepSeek V3',
    'qwen/qwen-2.5-32b-instruct': 'Qwen 3 32B',
    'qwen/qwen-2.5-vl-72b-instruct': 'Qwen 2.5 VL 72B',
    'mistral-medium-latest': 'Mistral Medium 3',
    'mistral-small-latest': 'Mistral Small 3.1',
    'pixtral-large-latest': 'Pixtral Large'
  };
  return MODEL_DISPLAY_NAMES[modelSlug] || modelSlug;
};

const getProviderDisplayName = (providerKey) => {
  const map = {
    groq: 'Groq',
    openrouter: 'OpenRouter',
    mistral: 'Mistral'
  };
  return map[providerKey] || providerKey;
};

const logProviderDecision = (task, provider, model) => {
  const taskLabel = task.toUpperCase();
  const providerLabel = getProviderDisplayName(provider);
  const modelLabel = getModelDisplayName(model);
  
  console.log(`\n[${taskLabel}]`);
  console.log(`Provider: ${providerLabel}`);
  console.log(`Model: ${modelLabel}`);
};

const logFallback = (task, failedProvider, error, nextProvider, nextModel) => {
  const taskLabel = task.toUpperCase();
  const failedProviderLabel = getProviderDisplayName(failedProvider);
  const nextProviderLabel = getProviderDisplayName(nextProvider);
  const nextModelLabel = getModelDisplayName(nextModel);
  
  const status = error.status || error.statusCode || '';
  const errorSuffix = status ? ` (${status})` : '';
  const reason = status === 429 ? 'Rate Limited' : 'Error';
  
  console.log(`\n[${taskLabel}]`);
  console.log(`${failedProviderLabel} ${reason}${errorSuffix}`);
  console.log(`Fallback: ${nextProviderLabel}`);
  console.log(`Model: ${nextModelLabel}`);
};

/**
 * Utility to run an async operation with both parent AbortSignal listener and an internal request timeout.
 */
const runWithSignalAndTimeout = async (fn, parentSignal, timeoutMs = 30000) => {
  const controller = new AbortController();
  
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      throw new Error('Aborted');
    }
    parentSignal.addEventListener('abort', onParentAbort);
  }
  
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
};

/**
 * Centered Non-streaming AI Response Gateway
 */
export const generateAIResponse = async ({ task, messages, temperature = 0.5, max_tokens = 4096, signal }) => {
  const providers = task === 'general_chat'
    ? ['mistral', 'openrouter']
    : ['groq', 'groq_secondary', 'openrouter', 'mistral'];
  let lastError = null;

  for (const provider of providers) {
    const model = getModelForTask(provider, task);
    const start = Date.now();
    const fallbackLevel = providers.indexOf(provider); // 0 = primary, 1 = fallback 1, etc.

    // Validate key presence before trying
    if (provider === 'groq' && !env.groq.apiKey) {
      continue;
    }
    if (provider === 'groq_secondary' && !env.groqSecondary.apiKey) {
      continue;
    }
    if (provider === 'openrouter' && !env.openRouter.apiKey) {
      continue;
    }
    if (provider === 'mistral' && !env.mistral.apiKey) {
      continue;
    }

    try {
      logProviderDecision(task, provider, model);

      let resultText = '';

      if (provider === 'groq' || provider === 'groq_secondary') {
        const client = provider === 'groq' ? groq : groqSecondary;
        const completion = await runWithSignalAndTimeout(
          (sig) => client.chat.completions.create({
            model,
            messages,
            temperature,
            max_tokens,
          }, { signal: sig }),
          signal,
          30000
        );
        resultText = completion.choices[0]?.message?.content || '';
      } else if (provider === 'openrouter') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.openRouter.apiKey}`,
              'HTTP-Referer': 'https://braudle.com',
              'X-Title': 'BRAUDLE',
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_tokens,
            }),
            signal: sig,
          }),
          signal,
          30000
        );

        if (!response.ok) {
          const err = new Error(`OpenRouter HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }

        const data = await response.json();
        resultText = data.choices?.[0]?.message?.content || '';
      } else if (provider === 'mistral') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${env.mistral.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_tokens,
            }),
            signal: sig,
          }),
          signal,
          30000
        );

        if (!response.ok) {
          const err = new Error(`Mistral HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }

        const data = await response.json();
        resultText = data.choices?.[0]?.message?.content || '';
      }

      const duration = Date.now() - start;
      console.log(`[AI GATEWAY] Success | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time: ${duration}ms`);
      return resultText;

    } catch (err) {
      const duration = Date.now() - start;
      console.error(`[AI GATEWAY] Failure | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time: ${duration}ms | Error: ${err.message || err}`);

      lastError = err;
      if (!isTransientError(err)) {
        console.error(`[AI GATEWAY] Non-transient error on ${provider}. Aborting fallback queue.`);
        throw err;
      }

      const nextProvider = providers[providers.indexOf(provider) + 1];
      if (nextProvider) {
        const nextModel = getModelForTask(nextProvider, task);
        logFallback(task, provider, err, nextProvider, nextModel);
      } else {
        console.error(`[AI GATEWAY] All providers failed. Last error:`, err.message);
      }
    }
  }

  throw lastError || new Error('AI Gateway failed to generate response');
};

/**
 * Centered Streaming AI Response Gateway (Returns async generator yielding OpenAI-compatible chunks)
 */
export async function* streamAIResponse({ task, messages, temperature = 0.7, max_tokens = 4096, signal }) {
  const providers = task === 'general_chat'
    ? ['mistral', 'openrouter']
    : ['groq', 'groq_secondary', 'openrouter', 'mistral'];
  let lastError = null;

  for (const provider of providers) {
    const model = getModelForTask(provider, task);
    const start = Date.now();
    const fallbackLevel = providers.indexOf(provider); // 0 = primary, 1 = fallback 1, etc.

    // Validate key presence before trying
    if (provider === 'groq' && !env.groq.apiKey) {
      continue;
    }
    if (provider === 'groq_secondary' && !env.groqSecondary.apiKey) {
      continue;
    }
    if (provider === 'openrouter' && !env.openRouter.apiKey) {
      continue;
    }
    if (provider === 'mistral' && !env.mistral.apiKey) {
      continue;
    }

    try {
      logProviderDecision(task, provider, model);

      if (provider === 'groq' || provider === 'groq_secondary') {
        const client = provider === 'groq' ? groq : groqSecondary;
        const stream = await runWithSignalAndTimeout(
          (sig) => client.chat.completions.create({
            model,
            messages,
            temperature,
            max_tokens,
            stream: true,
          }, { signal: sig }),
          signal,
          30000
        );

        const duration = Date.now() - start;
        console.log(`[AI GATEWAY] Success | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time (Stream Init): ${duration}ms`);

        for await (const chunk of stream) {
          yield chunk;
        }
        return;
      }

      if (provider === 'openrouter') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.openRouter.apiKey}`,
              'HTTP-Referer': 'https://braudle.com',
              'X-Title': 'BRAUDLE',
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_tokens,
              stream: true,
            }),
            signal: sig,
          }),
          signal,
          30000
        );

        if (!response.ok) {
          const err = new Error(`OpenRouter HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }

        const duration = Date.now() - start;
        console.log(`[AI GATEWAY] Success | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time (Stream Init): ${duration}ms`);

        const decoder = new TextDecoder();
        let buffer = '';
        const bodyStream = response.body;

        for await (const chunk of bodyStream) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const text = parsed.choices?.[0]?.delta?.content || '';
              if (text) {
                yield { choices: [{ delta: { content: text } }] };
              }
            } catch (e) {
              // Ignore invalid JSON on SSE lines
            }
          }
        }
        return;
      }

      if (provider === 'mistral') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${env.mistral.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_tokens,
              stream: true,
            }),
            signal: sig,
          }),
          signal,
          30000
        );

        if (!response.ok) {
          const err = new Error(`Mistral HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }

        const duration = Date.now() - start;
        console.log(`[AI GATEWAY] Success | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time (Stream Init): ${duration}ms`);

        const decoder = new TextDecoder();
        let buffer = '';
        const bodyStream = response.body;

        for await (const chunk of bodyStream) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const text = parsed.choices?.[0]?.delta?.content || '';
              if (text) {
                yield { choices: [{ delta: { content: text } }] };
              }
            } catch (e) {
              // Ignore invalid JSON on SSE lines
            }
          }
        }
        return;
      }
    } catch (err) {
      const duration = Date.now() - start;
      console.error(`[AI GATEWAY] Failure | Provider: ${provider} | Fallback Level: ${fallbackLevel} | Response Time: ${duration}ms | Error: ${err.message || err}`);

      lastError = err;
      if (!isTransientError(err)) {
        console.error(`[AI GATEWAY] Non-transient error on ${provider}. Aborting fallback queue.`);
        throw err;
      }

      const nextProvider = providers[providers.indexOf(provider) + 1];
      if (nextProvider) {
        const nextModel = getModelForTask(nextProvider, task);
        logFallback(task, provider, err, nextProvider, nextModel);
      } else {
        console.error(`[AI GATEWAY] All providers failed. Last error:`, err.message);
      }
    }
  }

  throw lastError || new Error('AI Gateway failed to generate response');
}

/**
 * Streams chat completions from Groq using the high-performance Llama models.
 * Refactored to act as a wrapper for streamAIResponse.
 * Used primarily for real-time tutoring sessions via SSE.
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

  const parentController = new AbortController();
  const generator = streamAIResponse({
    task: 'tutoring',
    messages,
    signal: parentController.signal
  });

  generator.abort = () => parentController.abort();
  return generator;
};

/**
 * Transcribes handwritten text from an image using Groq Vision.
 * Refactored to act as a wrapper for generateAIResponse (vision task).
 */
export const transcribeImage = async (imageBase64, mimeType = 'image/jpeg') => {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Transcribe all text (handwritten or typed) in this image accurately, and describe any diagrams, equations, or visual layouts. Preserve lists and headings. If there is no text, provide a concise visual description of the contents.',
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` },
        },
      ],
    },
  ];

  return generateAIResponse({ task: 'vision', messages });
};

/**
 * Performs a non-streaming call to Groq.
 * Refactored to act as a wrapper for generateAIResponse.
 */
export const callGroq = async (messages, model = GROQ_MODELS.smart) => {
  let task = 'analysis';
  if (model === GROQ_MODELS.smart) {
    task = 'tutoring';
  } else if (model === GROQ_MODELS.vision) {
    task = 'vision';
  }

  return generateAIResponse({ task, messages });
};

/**
 * Call Groq with basic exponential backoff for rate limits.
 * Refactored to delegate directly to generateAIResponse (which has its own multi-provider fallback logic).
 */
export const callGroqWithRetry = async (messages, model = GROQ_MODELS.smart, retries = 3) => {
  let task = 'analysis';
  if (model === GROQ_MODELS.smart) {
    task = 'tutoring';
  } else if (model === GROQ_MODELS.vision) {
    task = 'vision';
  }

  return generateAIResponse({ task, messages });
};

/**
 * Analyzes a completed session transcript to extract learning insights.
 */
export const analyzeSession = async (messages, documentTopics = []) => {
  const prompt = buildSessionAnalysisPrompt(messages, documentTopics);

  const response = await callGroqWithRetry(
    [{ role: 'user', content: prompt }],
    GROQ_MODELS.fast
  );

  const analysis = parseAIJson(response, { weakTopics: [], strongTopics: [], summary: '' });

  return {
    weakTopics: Array.isArray(analysis.weakTopics) ? analysis.weakTopics : [],
    strongTopics: Array.isArray(analysis.strongTopics) ? analysis.strongTopics : [],
    misconceptions: Array.isArray(analysis.misconceptions) ? analysis.misconceptions : [],
    summary: typeof analysis.summary === 'string' ? analysis.summary : ''
  };
};

/**
 * Evaluates a student's short/long theory answer against the correct answer.
 */
export const evaluateTheoryAnswer = async (question, studentAnswer, correctAnswer) => {
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return {
      evaluation: 'wrong',
      feedback: 'No answer was provided.',
    };
  }

  const prompt = `You are an educational evaluator grading a student's answer to a short theory question.
Compare the student's answer with the expected correct answer and determine if it is correct, partially correct, or incorrect. Also provide a direct, helpful, and friendly sentence explaining why it was graded this way.

QUESTION: "${question}"
EXPECTED ANSWER: "${correctAnswer}"
STUDENT'S ANSWER: "${studentAnswer}"

Rules:
- Mark as "correct" if the student's answer is accurate, complete, and covers the key points of the expected answer (even if phrased differently).
- Mark as "partial" if the student's answer is on the right track or has some correct elements, but is incomplete, slightly inaccurate, or missing details.
- Mark as "incorrect" if the student's answer is wrong, irrelevant, or fails to demonstrate understanding of the concept.

Return ONLY a JSON object with the following schema:
{
  "evaluation": "correct" | "partial" | "incorrect",
  "feedback": "Friendly feedback explaining exactly what they did well, what they missed, and how to improve."
}
Do NOT include markdown, backticks, or any explanation. Return only the raw JSON.`;

  try {
    const response = await callGroqWithRetry(
      [{ role: 'user', content: prompt }],
      GROQ_MODELS.fast
    );

    const parsed = parseAIJson(response, { evaluation: 'incorrect', feedback: 'Could not generate feedback.' });
    let evaluation = (parsed.evaluation || 'incorrect').toLowerCase().trim();
    const feedback = parsed.feedback || 'Your answer was evaluated.';

    if (evaluation === 'incorrect') evaluation = 'wrong';
    else if (evaluation !== 'correct' && evaluation !== 'partial') {
      if (evaluation.includes('correct')) evaluation = 'correct';
      else if (evaluation.includes('partial')) evaluation = 'partial';
      else evaluation = 'wrong';
    }

    return { evaluation, feedback };
  } catch (err) {
    console.error('[AI SERVICE] Theory evaluation failed:', err.message);
    return {
      evaluation: 'wrong',
      feedback: 'An error occurred while evaluating your answer.',
    };
  }
};
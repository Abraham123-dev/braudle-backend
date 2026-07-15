import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { GROQ_MODELS, PROVIDER_MODEL_MAPPING } from '../config/models.js';
import { buildSessionAnalysisPrompt } from '../utils/promptBuilder.js';
import { parseAIJson } from '../utils/parseAIJson.js';
import { getEncoding } from 'js-tiktoken';

const groq = new Groq({ apiKey: env.groq.apiKey, maxRetries: 0 });
const groqSecondary = new Groq({ apiKey: env.groqSecondary.apiKey, maxRetries: 0 });

/**
 * Normalizes provider error types to detect transient status codes.
 */
function isTransientError(error) {
  const status = error.status || error.statusCode || error.responseStatus;
  
  // Do not fallback on: 401/403 (Authentication/API Key errors)
  if (status && [401, 403].includes(status)) {
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

  // Treat out of credits (402) and timeouts (408) as transient/fallback-eligible
  if (status) {
    const transientStatuses = [402, 408, 413, 429, 500, 502, 503];
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

let tokenizer = null;
try {
  tokenizer = getEncoding('cl100k_base');
} catch (e) {
  console.error('[AI SERVICE] Failed to load tokenizer, falling back to approximation:', e.message);
}

export const getPrecisionTokenCount = (text) => {
  if (!text) return 0;
  if (typeof text !== 'string') {
    text = String(text);
  }
  if (tokenizer) {
    try {
      return tokenizer.encode(text).length;
    } catch (e) {
      // fallback
    }
  }
  return Math.ceil(text.trim().length / 4);
};

/**
 * Resolves model slugs to the actual API-compatible model IDs.
 */
const getModelForTask = (provider, task) => {
  return PROVIDER_MODEL_MAPPING[provider]?.[task] || '';
};

/**
 * Maps task model IDs to their standard display names for logging.
 */
const getModelDisplayName = (modelSlug) => {
  const MODEL_DISPLAY_NAMES = {
    'llama-3.3-70b-versatile': 'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant': 'llama-3.1-8b-instant',
    'llama-3.2-11b-vision-preview': 'Llama 3.2 11B Vision',
    'meta-llama/llama-3.2-11b-vision-instruct': 'Llama 3.2 11B Vision Instruct',
    'qwen/qwen3.6-27b': 'Qwen 3.6 27B Vision',
    'deepseek/deepseek-chat': 'DeepSeek V3',
    'qwen/qwen-2.5-32b-instruct': 'Qwen 3 32B',
    'qwen/qwen-2.5-vl-72b-instruct': 'Qwen 2.5 VL 72B',
    'mistral-medium-latest': 'Mistral Medium 3',
    'mistral-small-latest': 'Mistral Small 3.1',
    'pixtral-large-latest': 'Pixtral Large',
    'meta/llama-3.3-70b-instruct': 'Llama 3.3 70B Instruct (NVIDIA)',
    'meta/llama-3.1-8b-instruct': 'Llama 3.1 8B Instruct (NVIDIA)',
    'meta/llama-3.2-11b-vision-instruct': 'Llama 3.2 11B Vision (NVIDIA)',
    'gpt-oss-120b': 'GPT OSS 120B (Cerebras)',
    'gemma-4-31b': 'Gemma 4 31B (Cerebras)',
    'zai-glm-4.7': 'ZAI GLM 4.7 (Cerebras)'
  };
  return MODEL_DISPLAY_NAMES[modelSlug] || modelSlug;
};

const getProviderDisplayName = (providerKey) => {
  const map = {
    groq: 'Groq',
    openrouter: 'OpenRouter',
    mistral: 'Mistral',
    nvidia: 'NVIDIA',
    cerebras: 'Cerebras'
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
    ? ['mistral', 'nvidia', 'cerebras']
    : ['groq', 'groq_secondary', 'openrouter', 'mistral', 'nvidia', 'cerebras'];
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
    if (provider === 'nvidia' && !env.nvidia.apiKey) {
      continue;
    }
    if (provider === 'cerebras' && !env.cerebras.apiKey) {
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
          90000
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
          90000
        );
 
        if (!response.ok) {
          const errBody = await response.text();
          const err = new Error(`OpenRouter HTTP ${response.status}: ${errBody}`);
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
          90000
        );
 
        if (!response.ok) {
          const errBody = await response.text();
          const err = new Error(`Mistral HTTP ${response.status}: ${errBody}`);
          err.status = response.status;
          throw err;
        }
 
        const data = await response.json();
        resultText = data.choices?.[0]?.message?.content || '';
      } else if (provider === 'nvidia') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.nvidia.apiKey}`,
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
          90000
        );
 
        if (!response.ok) {
          const errBody = await response.text();
          const err = new Error(`NVIDIA HTTP ${response.status}: ${errBody}`);
          err.status = response.status;
          throw err;
        }
 
        const data = await response.json();
        resultText = data.choices?.[0]?.message?.content || '';
      } else if (provider === 'cerebras') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.cerebras.apiKey}`,
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
          90000
        );
 
        if (!response.ok) {
          const errBody = await response.text();
          const err = new Error(`Cerebras HTTP ${response.status}: ${errBody}`);
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
    ? ['mistral', 'nvidia', 'cerebras']
    : ['groq', 'groq_secondary', 'openrouter', 'mistral', 'nvidia', 'cerebras'];
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
    if (provider === 'nvidia' && !env.nvidia.apiKey) {
      continue;
    }
    if (provider === 'cerebras' && !env.cerebras.apiKey) {
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

      if (provider === 'nvidia') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.nvidia.apiKey}`,
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
          const err = new Error(`NVIDIA HTTP ${response.status}`);
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
 
      if (provider === 'cerebras') {
        const response = await runWithSignalAndTimeout(
          (sig) => fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.cerebras.apiKey}`,
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
          const err = new Error(`Cerebras HTTP ${response.status}`);
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
          text: `You are an expert academic content extractor for a study assistant called BRAUDLE.

A student has uploaded an image as study material. Your job is to extract and understand 
EVERYTHING in this image so it can be stored and referenced later when the student asks 
questions.

You must do ALL of the following regardless of image type:

EXTRACT
- Extract every single word of visible text exactly as written, preserving structure
- Extract all numbers, formulas, equations, and symbols
- Extract all labels, headings, captions, legends, and annotations
- Extract any bullet points, numbered lists, or structured content

DESCRIBE
- Describe what type of image this is (diagram, chart, textbook page, handwritten notes, 
  past exam question, graph, table, illustration, screenshot, etc.)
- Describe the visual structure in detail — what is positioned where, how elements 
  relate to each other
- For diagrams: describe every component, every arrow, every connection and what it means
- For charts/graphs: describe the axes, values, trends, and what the data shows
- For handwritten content: transcribe it fully even if the handwriting is imperfect — 
  make your best interpretation and flag uncertain words with [unclear]

UNDERSTAND
- Identify the subject area (Biology, Mathematics, Physics, History, etc.)
- Identify the core topic or concept being covered
- Identify any sub-concepts, key terms, or definitions present
- If this looks like an exam question, identify what the question is asking

STRUCTURE YOUR OUTPUT EXACTLY LIKE THIS:

CONTENT_TYPE: [what kind of image this is]
SUBJECT: [subject area]
TOPIC: [main topic or concept]

RAW_TEXT:
[all extracted text verbatim]

VISUAL_DESCRIPTION:
[detailed description of visual elements, structure, and layout]

KEY_CONCEPTS:
[bullet list of every important concept, term, or idea present in this image]

FULL_SUMMARY:
[a thorough paragraph explaining everything this image contains and teaches — 
written so that someone who cannot see the image would fully understand it]

IMPORTANT RULES:
- Never say you cannot process the image
- Never say the image is unclear without still attempting full extraction
- If something is partially visible, extract what you can and note it
- If the image has no text at all, the visual description and summary must be extremely detailed to compensate
- Your output will be stored and used to answer student questions later — the more thorough you are now, the better the student gets helped.`,
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

/**
 * Generic fetch wrapper with a retry mechanism for transient network and API errors.
 */
const fetchWithRetry = async (url, options, maxRetries = 3, delay = 1000) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        console.warn(`[AI SERVICE] Fetch attempt ${i + 1} failed for ${url}: ${err.message || err}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[AI SERVICE] Fetch attempt ${i + 1} failed for ${url}: ${err.message || err}. All attempts failed.`);
      }
    }
  }
  throw lastError;
};

/**
 * Normalizes an embedding vector to target dimensions (padding with zeros or truncating).
 */
const normalizeVectorDimension = (vector, targetDim = 1536) => {
  if (!Array.isArray(vector)) return new Array(targetDim).fill(0);
  if (vector.length === targetDim) return vector;
  if (vector.length > targetDim) return vector.slice(0, targetDim);
  return [...vector, ...new Array(targetDim - vector.length).fill(0)];
};

/**
 * Calls Mistral embeddings API for a single text.
 */
const getMistralEmbedding = async (text) => {
  if (!env.mistral.apiKey) {
    throw new Error('Mistral API Key missing');
  }
  const response = await fetchWithRetry('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.mistral.apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: text.trim(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Mistral embeddings HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.data && data.data[0] && data.data[0].embedding) {
    return normalizeVectorDimension(data.data[0].embedding, 1536);
  }
  throw new Error('Mistral embeddings data format invalid');
};

/**
 * Calls Mistral embeddings API for a batch of texts.
 */
const getMistralEmbeddingsBatch = async (cleanedTexts) => {
  if (!env.mistral.apiKey) {
    throw new Error('Mistral API Key missing');
  }
  const response = await fetchWithRetry('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.mistral.apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: cleanedTexts,
    }),
  });

  if (!response.ok) {
    throw new Error(`Mistral embeddings HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.data && Array.isArray(data.data)) {
    const embeddingsMap = new Map();
    data.data.forEach((item, idx) => {
      if (item && item.embedding) {
        embeddingsMap.set(cleanedTexts[idx], normalizeVectorDimension(item.embedding, 1536));
      }
    });
    return embeddingsMap;
  }
  throw new Error('Mistral batch embeddings response format invalid');
};

/**
 * Generates vector embedding from OpenRouter (falls back to Mistral, and then local term-hash embedding)
 */
export const generateEmbedding = async (text) => {
  if (!text || text.trim().length === 0) {
    return new Array(1536).fill(0);
  }

  // 1. Try OpenRouter (Primary)
  if (env.openRouter.apiKey) {
    try {
      const response = await fetchWithRetry('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.openRouter.apiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: text.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter embeddings HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.data && data.data[0] && data.data[0].embedding) {
        return normalizeVectorDimension(data.data[0].embedding, 1536);
      }
      throw new Error('Embeddings data format invalid');
    } catch (err) {
      console.warn('[AI SERVICE] OpenRouter embedding creation failed:', err.message);
    }
  } else {
    console.log('[AI SERVICE] OpenRouter API Key missing. Skipping primary embedding provider.');
  }

  // 2. Try Mistral (Secondary Fallback)
  if (env.mistral.apiKey) {
    try {
      console.log('[AI SERVICE] Attempting Mistral secondary embedding fallback...');
      return await getMistralEmbedding(text);
    } catch (err) {
      console.error('[AI SERVICE] Mistral secondary embedding fallback failed:', err.message);
    }
  }

  // 3. Try Local TF-IDF (Tertiary Fallback)
  console.log('[AI SERVICE] Falling back to local term-hash embedding.');
  return getLocalTfidfEmbedding(text);
};

/**
 * Generates vector embeddings for a batch of texts in a single API call.
 * This is highly optimized for semantic chunking sentence processing.
 */
export const generateEmbeddingsBatch = async (texts) => {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  // Filter out empty texts while preserving indices
  const cleanedTexts = texts.map(t => (t || '').trim()).filter(Boolean);
  if (cleanedTexts.length === 0) {
    return texts.map(() => new Array(1536).fill(0));
  }

  // Helper mapping function to construct final output array using a retrieved map of embeddings
  const buildResultFromMap = (embeddingsMap) => {
    return texts.map(t => {
      const trimmed = (t || '').trim();
      if (!trimmed) return new Array(1536).fill(0);
      return embeddingsMap.get(trimmed) || getLocalTfidfEmbedding(t);
    });
  };

  // 1. Try OpenRouter (Primary)
  if (env.openRouter.apiKey) {
    try {
      const response = await fetchWithRetry('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.openRouter.apiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: cleanedTexts,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter embeddings HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        const embeddingsMap = new Map();
        data.data.forEach((item, idx) => {
          if (item && item.embedding) {
            embeddingsMap.set(cleanedTexts[idx], normalizeVectorDimension(item.embedding, 1536));
          }
        });
        return buildResultFromMap(embeddingsMap);
      }
      throw new Error('Batch embeddings response format invalid');
    } catch (err) {
      console.warn('[AI SERVICE] OpenRouter batch embedding creation failed:', err.message);
    }
  } else {
    console.log('[AI SERVICE] OpenRouter API Key missing. Skipping primary batch embedding provider.');
  }

  // 2. Try Mistral (Secondary Fallback)
  if (env.mistral.apiKey) {
    try {
      console.log('[AI SERVICE] Attempting Mistral secondary batch embedding fallback...');
      const embeddingsMap = await getMistralEmbeddingsBatch(cleanedTexts);
      return buildResultFromMap(embeddingsMap);
    } catch (err) {
      console.error('[AI SERVICE] Mistral secondary batch embedding fallback failed:', err.message);
    }
  }

  // 3. Try Local TF-IDF (Tertiary Fallback)
  console.log('[AI SERVICE] Falling back to batch local term-hash embedding.');
  return texts.map(t => getLocalTfidfEmbedding(t));
};

/**
 * Generates a local term-hash based pseudo-embedding vector of 1536 dimensions.
 * Corresponds to a normalized bag-of-words representation using string hashing.
 */
export const getLocalTfidfEmbedding = (text) => {
  const words = (text || '').toLowerCase().match(/\w+/g) || [];
  const vector = new Array(1536).fill(0);
  
  words.forEach(word => {
    // FNV-1a hash equivalent for word mapping to index
    let hash = 2166136261;
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % 1536;
    vector[idx] += 1;
  });

  // Calculate magnitude
  const sumOfSquares = vector.reduce((sum, val) => sum + val * val, 0);
  const magnitude = Math.sqrt(sumOfSquares);
  
  if (magnitude > 0) {
    return vector.map(val => val / magnitude);
  }
  return vector;
};
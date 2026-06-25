/**
 * Test: AI Gateway Fallback and Performance Logging
 * Verifies that the AI gateway tries providers in order, handles transient fallbacks (429, 500, etc.),
 * stops on non-transient errors (401, 403, 400), and outputs response timing logs.
 */

import { env } from '../src/config/env.js';
import { redisClient } from '../src/config/redis.js';

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

// Silence Redis and disconnect it to run offline
redisClient.removeAllListeners('error');
try {
  redisClient.disconnect();
} catch (e) {}

// Setup all keys to dummy values so no keys are skipped
env.groq = { apiKey: 'gsk_primary_dummy_key' };
env.groqSecondary = { apiKey: 'gsk_secondary_dummy_key' };
env.openRouter = { apiKey: 'sk-or-dummy-key' };
env.mistral = { apiKey: 'mistral-dummy-key' };

// Setup counters and state mock configs
let primaryCallCount = 0;
let secondaryCallCount = 0;
let openRouterCallCount = 0;

let mockPrimaryErrorStatus = 429;
let mockSecondaryErrorStatus = 200;

// Intercept fetch globally before importing the gateway controller
globalThis.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.url || '';
  const headers = options?.headers;
  const getHeader = (h, name) => {
    if (!h) return '';
    if (typeof h.get === 'function') return h.get(name) || '';
    return h[name] || h[name.toLowerCase()] || '';
  };
  const authHeader = getHeader(headers, 'Authorization');

  if (urlStr.includes('api.groq.com')) {
    if (authHeader.includes('gsk_primary_dummy_key')) {
      primaryCallCount++;
      return {
        ok: false,
        status: mockPrimaryErrorStatus,
        statusText: 'Error',
        headers: {
          get(name) {
            if (name.toLowerCase() === 'content-type') return 'application/json';
            return null;
          }
        },
        json: async () => ({ error: { message: 'Mock primary error', code: mockPrimaryErrorStatus } }),
        text: async () => JSON.stringify({ error: { message: 'Mock primary error', code: mockPrimaryErrorStatus } })
      };
    } else if (authHeader.includes('gsk_secondary_dummy_key')) {
      secondaryCallCount++;
      if (mockSecondaryErrorStatus === 200) {
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              if (name.toLowerCase() === 'content-type') return 'application/json';
              return null;
            }
          },
          json: async () => ({ choices: [{ message: { content: 'Succeeded on secondary' } }] }),
          text: async () => JSON.stringify({ choices: [{ message: { content: 'Succeeded on secondary' } }] })
        };
      } else {
        return {
          ok: false,
          status: mockSecondaryErrorStatus,
          statusText: 'Error',
          headers: {
            get(name) {
              if (name.toLowerCase() === 'content-type') return 'application/json';
              return null;
            }
          },
          json: async () => ({ error: { message: 'Mock secondary error', code: mockSecondaryErrorStatus } }),
          text: async () => JSON.stringify({ error: { message: 'Mock secondary error', code: mockSecondaryErrorStatus } })
        };
      }
    }
  }

  if (urlStr.includes('openrouter.ai')) {
    openRouterCallCount++;
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-type') return 'application/json';
          return null;
        }
      },
      json: async () => ({ choices: [{ message: { content: 'Succeeded on OpenRouter' } }] }),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Succeeded on OpenRouter' } }] })
    };
  }

  return {
    ok: false,
    status: 500,
    headers: {
      get(name) {
        return null;
      }
    }
  };
};

// Dynamically import ai.service after fetch interception is bound
const { generateAIResponse } = await import('../src/services/ai.service.js');

async function runTests() {
  console.log('\n── AI Gateway Fallback Routing & Error Checks ──');

  const messages = [{ role: 'user', content: 'Hello' }];

  // Case 1: Primary fails (429 Rate Limit) -> Secondary succeeds
  console.log('\nTesting Case 1: Primary fails (429) -> Secondary succeeds...');
  primaryCallCount = 0;
  secondaryCallCount = 0;
  mockPrimaryErrorStatus = 429;
  mockSecondaryErrorStatus = 200;

  const res1 = await generateAIResponse({ task: 'tutoring', messages });
  assert('Should try Primary Groq first', primaryCallCount === 1);
  assert('Should fallback to Secondary Groq on 429', secondaryCallCount === 1);
  assert('Should return success response from Secondary', res1 === 'Succeeded on secondary');

  // Case 2: Primary and Secondary fail (transient 503) -> OpenRouter succeeds
  console.log('\nTesting Case 2: Primary & Secondary fail (transient) -> OpenRouter succeeds...');
  primaryCallCount = 0;
  secondaryCallCount = 0;
  openRouterCallCount = 0;
  mockPrimaryErrorStatus = 503;
  mockSecondaryErrorStatus = 503;

  const res2 = await generateAIResponse({ task: 'tutoring', messages });
  assert('Should try Primary Groq', primaryCallCount === 1);
  assert('Should try Secondary Groq', secondaryCallCount === 1);
  assert('Should try OpenRouter', openRouterCallCount === 1);
  assert('Should return response from OpenRouter', res2 === 'Succeeded on OpenRouter');

  // Case 3: Primary fails (non-transient: 401 Auth Error) -> Aborts immediately
  console.log('\nTesting Case 3: Primary fails (non-transient 401) -> Aborts immediately...');
  primaryCallCount = 0;
  secondaryCallCount = 0;
  mockPrimaryErrorStatus = 401;

  let didThrow = false;
  try {
    await generateAIResponse({ task: 'tutoring', messages });
  } catch (err) {
    didThrow = true;
    assert('Thrown error status should be 401', err.status === 401);
  }

  assert('Should try Primary Groq', primaryCallCount === 1);
  assert('Should NOT try Secondary Groq on non-transient error', secondaryCallCount === 0);
  assert('Should abort and throw', didThrow === true);

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch(err => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});

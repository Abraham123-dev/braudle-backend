/**
 * Test: General Chat Token & Conversation Limits Flow
 * Verifies that the General Chat controller tracks daily token usage and conversation message counts,
 * enforces natural language response locks, handles 12-hour resets, and blocks requests when limits are exceeded.
 */

import { getGeneralChat, sendGeneralChatMessage, getGeneralChatSessionMessages } from '../src/controllers/generalChat.controller.js';
import GeneralChatUsage from '../src/models/GeneralChatUsage.model.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';
import StudentProfile from '../src/models/StudentProfile.model.js';
import { redisClient } from '../src/config/redis.js';
import { env } from '../src/config/env.js';

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

// 1. Silence Redis and disconnect it to run offline
redisClient.removeAllListeners('error');
redisClient.removeAllListeners('connect');
redisClient.removeAllListeners('close');
redisClient.on('error', () => {});
try {
  redisClient.disconnect();
} catch (e) {}

// 2. Set dummy API keys so ai.service does not skip Mistral/OpenRouter
env.mistral = { apiKey: 'dummy-mistral-api-key' };
env.openRouter = { apiKey: 'dummy-openrouter-api-key' };

// 3. Mock global fetch to return SSE stream for streaming AI responses
globalThis.fetch = async (url, options) => {
  return {
    ok: true,
    status: 200,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode('data: {"choices": [{"delta": {"content": "Mocked learning response content."}}]}\n\n');
        yield new TextEncoder().encode('data: [DONE]\n\n');
      }
    }
  };
};

// 4. Mock Database state objects
let mockUsageDb = {
  userId: '60c72b2f9b1d8e2504812345',
  tokensUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  lastResetAt: new Date(),
  async save() {
    return this;
  }
};

let mockSessionDb = {
  _id: '60c72b2f9b1d8e2504812346',
  userId: '60c72b2f9b1d8e2504812345',
  title: 'New Chat',
  messages: [],
  async save() {
    return this;
  }
};

let mockProfileDb = {
  userId: '60c72b2f9b1d8e2504812345',
  xp: 0,
  streak: 0,
  longestStreak: 0,
  lastStudyDate: null,
  totalSessions: 0,
  async save() {
    return this;
  }
};

// 5. Bind mock methods to Mongoose models
GeneralChatUsage.findOne = async () => mockUsageDb;
GeneralChatUsage.create = async (data) => {
  mockUsageDb = {
    userId: data.userId,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastResetAt: new Date(),
    async save() { return this; }
  };
  return mockUsageDb;
};

GeneralChatSession.find = () => {
  return {
    sort() {
      return [mockSessionDb];
    }
  };
};

GeneralChatSession.findOne = async () => mockSessionDb;
GeneralChatSession.create = async (data) => {
  mockSessionDb = {
    _id: '60c72b2f9b1d8e2504812346',
    userId: data.userId,
    title: data.title || 'New Chat',
    messages: [],
    async save() { return this; }
  };
  return mockSessionDb;
};

StudentProfile.findOne = async () => mockProfileDb;

const callController = (controllerFn, req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      sseChunks: [],
      setHeader(name, val) {
        this.headers[name] = val;
      },
      write(data) {
        this.sseChunks.push(data);
      },
      end() {
        resolve(this);
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        this.body = obj;
        resolve(this);
        return this;
      }
    };
    const next = (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    };
    controllerFn(req, res, next);
  });
};

async function runTests() {
  console.log('\n── General Chat Token & Conversation Limits Tests ──');

  // Case 1: Initial state check (0 tokens used, unlocked)
  console.log('\nTesting Case 1: Initial state...');
  mockUsageDb.tokensUsed = 0;
  mockUsageDb.inputTokens = 0;
  mockUsageDb.outputTokens = 0;
  mockUsageDb.lastResetAt = new Date();
  mockSessionDb.messages = [];

  const reqGet = { user: { id: '60c72b2f9b1d8e2504812345' } };
  const resGet = await callController(getGeneralChat, reqGet);

  assert('Should return success status', resGet.body?.status === 'success');
  assert('Tokens used should be 0', resGet.body?.usage?.tokensUsed === 0);
  assert('Remaining tokens should be 20000', resGet.body?.usage?.remainingTokens === 20000);
  assert('Lock status should be false', resGet.body?.usage?.isLocked === false);

  // Case 2: Daily Token reset check (12-hour reset)
  console.log('\nTesting Case 2: 12-hour reset...');
  const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
  mockUsageDb.tokensUsed = 15000;
  mockUsageDb.lastResetAt = thirteenHoursAgo;

  const resGetReset = await callController(getGeneralChat, reqGet);
  assert('Tokens used should be reset to 0 after 12 hours', resGetReset.body?.usage?.tokensUsed === 0);
  assert('Remaining tokens should be 20000 after reset', resGetReset.body?.usage?.remainingTokens === 20000);
  assert('lastResetAt should be updated to current time', mockUsageDb.lastResetAt.getTime() > thirteenHoursAgo.getTime());

  // Case 3: Conversation limit (15 user messages)
  console.log('\nTesting Case 3: Conversation length limit (15 user messages)...');
  mockUsageDb.tokensUsed = 0;
  mockUsageDb.lastResetAt = new Date();
  mockSessionDb.messages = [];

  // Populate 14 user messages and 14 assistant messages
  for (let i = 1; i <= 14; i++) {
    mockSessionDb.messages.push({ role: 'user', content: `Question ${i}` });
    mockSessionDb.messages.push({ role: 'assistant', content: `Answer ${i}` });
  }

  // Get messages for the session to check if locked is false initially
  const reqSessionMsgs = { user: { id: '60c72b2f9b1d8e2504812345' }, params: { id: '60c72b2f9b1d8e2504812346' } };
  const resSessionMsgs1 = await callController(getGeneralChatSessionMessages, reqSessionMsgs);
  assert('Session should not be locked at 14 user messages', resSessionMsgs1.body?.session?.isLocked === false);

  // Send 15th user message
  console.log('Sending 15th message...');
  const reqPost15 = {
    user: { id: '60c72b2f9b1d8e2504812345' },
    params: { id: '60c72b2f9b1d8e2504812346' },
    body: { message: 'Question 15' }
  };
  const resPost15 = await callController(sendGeneralChatMessage, reqPost15);
  assert('15th message should return SSE stream success', resPost15.statusCode === 200);

  // Verify conversation is now locked
  const resSessionMsgs2 = await callController(getGeneralChatSessionMessages, reqSessionMsgs);
  assert('Session should be locked after 15 user messages', resSessionMsgs2.body?.session?.isLocked === true);

  // Send 16th user message (should block with 403 CONVERSATION_LIMIT_EXCEEDED)
  console.log('Sending 16th message (expecting block)...');
  const reqPost16 = {
    user: { id: '60c72b2f9b1d8e2504812345' },
    params: { id: '60c72b2f9b1d8e2504812346' },
    body: { message: 'Question 16' }
  };
  const resPost16 = await callController(sendGeneralChatMessage, reqPost16);
  assert('Should return 403 status code for 16th message', resPost16.statusCode === 403);
  assert('Should return CONVERSATION_LIMIT_EXCEEDED error code', resPost16.body?.code === 'CONVERSATION_LIMIT_EXCEEDED');
  assert('Should have custom natural language error message', resPost16.body?.message?.includes("You've reached the limit for this conversation"));

  // Case 4: Daily Token budget Limit (20,000 tokens)
  console.log('\nTesting Case 4: Daily Token budget limit (20,000 tokens)...');
  mockSessionDb.messages = []; // reset conversation messages count
  mockUsageDb.tokensUsed = 19990; // almost full
  mockUsageDb.lastResetAt = new Date();

  // Send a message that consumes tokens
  console.log('Sending message to exceed remaining daily tokens...');
  const reqPostTokenExceed = {
    user: { id: '60c72b2f9b1d8e2504812345' },
    params: { id: '60c72b2f9b1d8e2504812346' },
    body: { message: 'This message has some length to consume tokens' }
  };
  const resPostTokenExceed = await callController(sendGeneralChatMessage, reqPostTokenExceed);
  assert('Initial token exceeding message should be processed successfully', resPostTokenExceed.statusCode === 200);
  assert('Tokens used should now be >= 20000', mockUsageDb.tokensUsed >= 20000);

  // Send another message (should block with 403 TOKEN_LIMIT_EXCEEDED)
  console.log('Sending another message after exceeding budget (expecting block)...');
  const reqPostTokenExceeded = {
    user: { id: '60c72b2f9b1d8e2504812345' },
    params: { id: '60c72b2f9b1d8e2504812346' },
    body: { message: 'Another query' }
  };
  const resPostTokenExceeded = await callController(sendGeneralChatMessage, reqPostTokenExceeded);
  assert('Should return 403 status code for token limit', resPostTokenExceeded.statusCode === 403);
  assert('Should return TOKEN_LIMIT_EXCEEDED error code', resPostTokenExceeded.body?.code === 'TOKEN_LIMIT_EXCEEDED');
  assert('Should have custom natural language error message', resPostTokenExceeded.body?.message?.includes("used all of your AI chat access for now"));

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runTests().catch(err => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});

/**
 * Test: Google-linked email magic link login guard
 * Verifies that startEmailLogin detects existing Google-only accounts,
 * returns a 409 status, and blocks magic link sending, preventing
 * confusing account/provider mixing.
 */

// 1. Mock Resend prototype using a getter/setter to intercept instance property assignment
import { Resend } from 'resend';
Object.defineProperty(Resend.prototype, 'emails', {
  get() {
    return {
      send: async () => {
        return { id: 'mock-email-id' };
      }
    };
  },
  set() {
    // Ignore setting the property so the getter always wins
  },
  configurable: true
});

import { startEmailLogin } from '../src/controllers/auth.controller.js';
import User from '../src/models/User.model.js';
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

// 2. Mock Redis client to avoid Redis server errors
redisClient.set = async () => 'OK';
redisClient.get = async () => null;

// Helper to await async middleware completion
const callController = (controllerFn, req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
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
    // Call the middleware
    controllerFn(req, res, next);
  });
};

// 4. Run tests
async function runTests() {
  console.log('\n── startEmailLogin Google Guard ──');

  // Case 1: Existing Google-linked account
  // Mock User.findOne returning a google-only user
  User.findOne = () => {
    return {
      select: () => Promise.resolve({
        authProvider: 'google',
        googleId: 'google-12345'
      })
    };
  };

  const req1 = { body: { email: 'google.user@example.com' } };
  const res1 = await callController(startEmailLogin, req1);

  assert('Should return 409 status code', res1.statusCode === 409);
  assert('Should return GOOGLE_ACCOUNT_EXISTS error code', res1.body?.code === 'GOOGLE_ACCOUNT_EXISTS');
  assert('Should return helpful warning message', res1.body?.message?.includes('Please sign in with Google'));

  // Case 2: Normal email login flow (no existing user / email provider user)
  // Mock User.findOne returning no user or normal user
  User.findOne = () => {
    return {
      select: () => Promise.resolve(null)
    };
  };

  const req2 = { body: { email: 'new.student@example.com' } };
  const res2 = await callController(startEmailLogin, req2);

  assert('Should return 200 status code', res2.statusCode === 200);
  assert('Should return generic inbox confirmation message', res2.body?.message?.includes('magic login link has been sent'));

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  redisClient.disconnect();
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});

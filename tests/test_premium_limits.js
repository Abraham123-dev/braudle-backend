/**
 * Test: Premium Tier Rate Limits
 * Verifies that the rate limiters dynamically return correct limit values
 * matching user subscription plans (free, plus, large) and administrative privileges.
 */

import dotenv from 'dotenv';
dotenv.config();

import { 
  sessionChatLimiter, 
  quizGenerationLimiter, 
  uploadPdfLimiter,
  getChatMax,
  getQuizGenMax,
  getPdfUploadMax
} from '../src/middleware/rateLimit.middleware.js';

let passed = 0;
let failed = 0;

function assert(description, condition, extra = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ' | ' + extra : ''}`);
    failed++;
  }
}

function runTests() {
  console.log('\n── Running Rate Limit Tier Alignment Tests ──');

  // Helper to extract the limit value from an express-rate-limit configuration
  const getLimiterMax = (limiter, mockReq) => {
    if (limiter === sessionChatLimiter) return getChatMax(mockReq);
    if (limiter === quizGenerationLimiter) return getQuizGenMax(mockReq);
    if (limiter === uploadPdfLimiter) return getPdfUploadMax(mockReq);
    return undefined;
  };

  // MOCK REQUESTS
  const mockFreeUserReq = { user: { role: 'student', plan: 'free' } };
  const mockPlusUserReq = { user: { role: 'student', plan: 'plus' } };
  const mockLargeUserReq = { user: { role: 'student', plan: 'large' } };
  const mockAdminUserReq = { user: { role: 'admin', plan: 'free' } };

  // 1. Verify Session Chat Limiter
  console.log('\nTesting Session Chat Limits (Messages per hour)...');
  const chatLimitFree = getLimiterMax(sessionChatLimiter, mockFreeUserReq);
  const chatLimitPlus = getLimiterMax(sessionChatLimiter, mockPlusUserReq);
  const chatLimitLarge = getLimiterMax(sessionChatLimiter, mockLargeUserReq);
  const chatLimitAdmin = getLimiterMax(sessionChatLimiter, mockAdminUserReq);

  console.log(`  Free: ${chatLimitFree}/hr | Plus: ${chatLimitPlus}/hr | Large: ${chatLimitLarge}/hr | Admin: ${chatLimitAdmin}/hr`);

  const isDev = chatLimitFree === 1000;
  if (isDev) {
    console.log('Running in Development mode (relaxed limits).');
    assert('Free user gets dev chat limit of 1000', chatLimitFree === 1000);
    assert('Plus user gets dev chat limit of 1000', chatLimitPlus === 1000);
    assert('Large user gets dev chat limit of 1000', chatLimitLarge === 1000);
  } else {
    console.log('Running in Production mode (strict limits).');
    assert('Free user gets chat limit of 60', chatLimitFree === 60);
    assert('Plus user gets chat limit of 500', chatLimitPlus === 500);
    assert('Large user gets chat limit of 500', chatLimitLarge === 500);
    assert('Admin user gets chat limit of 500', chatLimitAdmin === 500);
  }

  // 2. Verify Quiz Generation Limiter
  console.log('\nTesting Quiz Generation Limits (Generations per day)...');
  const quizLimitFree = getLimiterMax(quizGenerationLimiter, mockFreeUserReq);
  const quizLimitPlus = getLimiterMax(quizGenerationLimiter, mockPlusUserReq);
  const quizLimitLarge = getLimiterMax(quizGenerationLimiter, mockLargeUserReq);
  const quizLimitAdmin = getLimiterMax(quizGenerationLimiter, mockAdminUserReq);

  console.log(`  Free: ${quizLimitFree}/day | Plus: ${quizLimitPlus}/day | Large: ${quizLimitLarge}/day | Admin: ${quizLimitAdmin}/day`);

  if (isDev) {
    assert('Free user gets dev quiz generation limit of 100', quizLimitFree === 100);
    assert('Plus user gets dev quiz generation limit of 100', quizLimitPlus === 100);
    assert('Large user gets dev quiz generation limit of 100', quizLimitLarge === 100);
    assert('Admin user gets dev quiz generation limit of 100', quizLimitAdmin === 100);
  } else {
    assert('Free user gets quiz generation limit of 5', quizLimitFree === 5);
    assert('Plus user gets quiz generation limit of 5', quizLimitPlus === 5);
    assert('Large user gets quiz generation limit of 1000 (Unlimited)', quizLimitLarge === 1000);
    assert('Admin user gets quiz generation limit of 1000 (Unlimited)', quizLimitAdmin === 1000);
  }

  // 3. Verify PDF Upload Limiter
  console.log('\nTesting PDF Upload Limits (Uploads per day)...');
  const uploadLimitFree = getLimiterMax(uploadPdfLimiter, mockFreeUserReq);
  const uploadLimitPlus = getLimiterMax(uploadPdfLimiter, mockPlusUserReq);
  const uploadLimitLarge = getLimiterMax(uploadPdfLimiter, mockLargeUserReq);
  const uploadLimitAdmin = getLimiterMax(uploadPdfLimiter, mockAdminUserReq);

  console.log(`  Free: ${uploadLimitFree}/day | Plus: ${uploadLimitPlus}/day | Large: ${uploadLimitLarge}/day | Admin: ${uploadLimitAdmin}/day`);

  if (isDev) {
    assert('Free user gets dev PDF upload limit of 50', uploadLimitFree === 50);
    assert('Plus user gets dev PDF upload limit of 50', uploadLimitPlus === 50);
    assert('Large user gets dev PDF upload limit of 50', uploadLimitLarge === 50);
    assert('Admin user gets dev PDF upload limit of 50', uploadLimitAdmin === 50);
  } else {
    assert('Free user gets PDF upload limit of 5', uploadLimitFree === 5);
    assert('Plus user gets PDF upload limit of 10', uploadLimitPlus === 10);
    assert('Large user gets PDF upload limit of 1000 (Unlimited)', uploadLimitLarge === 1000);
    assert('Admin user gets PDF upload limit of 1000 (Unlimited)', uploadLimitAdmin === 1000);
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

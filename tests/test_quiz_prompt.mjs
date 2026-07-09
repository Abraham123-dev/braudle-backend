/**
 * Test: buildQuizPrompt documentTopics parameter propagation
 * Verifies Bug #3 fix — that documentTopics from the controller
 * actually reaches the AI prompt string.
 */

import { buildQuizPrompt } from '../src/utils/promptBuilder.js';

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

const fakeChunks = [
  'The mitochondria is the powerhouse of the cell.',
  'ATP is produced via the electron transport chain.',
];

const fakeProfile = { level: 'beginner' };

console.log('\n── buildQuizPrompt with documentTopics ──');

// Case 1: With documentTopics — should use STRICT REQUIREMENT instruction
const topicsArr = ['Cell Biology', 'Energy Production', 'Organelles'];
const promptWithTopics = buildQuizPrompt(fakeChunks, fakeProfile, 5, topicsArr);

assert(
  'Prompt contains STRICT REQUIREMENT when topics provided',
  promptWithTopics.includes('STRICT REQUIREMENT')
);
assert(
  'Prompt contains the exact topic "Cell Biology"',
  promptWithTopics.includes('Cell Biology')
);
assert(
  'Prompt contains the exact topic "Energy Production"',
  promptWithTopics.includes('Energy Production')
);
assert(
  'Prompt does NOT use fallback "Assign a specific topic" when topics are provided',
  !promptWithTopics.includes('Assign a specific topic name')
);
assert(
  'Prompt contains the correct question count (5)',
  promptWithTopics.includes('Generate exactly 5 questions')
);

// Case 2: With empty documentTopics [] — should use generic fallback
const promptWithoutTopics = buildQuizPrompt(fakeChunks, fakeProfile, 5, []);
assert(
  'Prompt uses generic fallback when documentTopics is empty',
  promptWithoutTopics.includes('Assign a specific topic name')
);
assert(
  'Prompt does NOT contain STRICT REQUIREMENT when no topics given',
  !promptWithoutTopics.includes('STRICT REQUIREMENT')
);

// Case 3: Omitting the 4th param entirely — should default to [] and use fallback
const promptNoParam = buildQuizPrompt(fakeChunks, fakeProfile, 5);
assert(
  'Prompt defaults to generic fallback when documentTopics param is omitted',
  promptNoParam.includes('Assign a specific topic name')
);

// Case 4: Level-specific language
const advancedProfile = { level: 'advanced' };
const advancedPrompt = buildQuizPrompt(fakeChunks, advancedProfile, 3, []);
assert(
  'Advanced profile produces challenging question instruction',
  advancedPrompt.includes('multi-step reasoning, synthesis of multiple concepts')
);

const intermediateProfile = { level: 'intermediate' };
const intermediatePrompt = buildQuizPrompt(fakeChunks, intermediateProfile, 3, []);
assert(
  'Intermediate profile produces application question instruction',
  intermediatePrompt.includes('application of knowledge')
);

// Case 5: With conceptFocus — should inject CONCEPT LOCK note
const promptWithConcept = buildQuizPrompt(fakeChunks, fakeProfile, 5, [], 'Photosynthesis');
assert(
  'Prompt contains CONCEPT LOCK when conceptFocus is provided',
  promptWithConcept.includes('⚡ CONCEPT LOCK: ALL questions MUST be exclusively about "Photosynthesis"')
);

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);

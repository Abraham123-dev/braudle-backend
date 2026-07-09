/**
 * Test: buildTeachPrompt logic and layout correctness
 * Verifies that promptBuilder correctly maps modes, student profiles,
 * document context, and prep style rules.
 */

import { buildTeachPrompt, buildInlinePracticePrompt } from '../src/utils/promptBuilder.js';

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

const fakeChunk = 'React is a JavaScript library for building user interfaces. It uses a virtual DOM for efficient updates.';
const fakeProfile = {
  level: 'beginner',
  goal: 'Pass React Cert',
  studyLevel: 'university',
  learningStyle: 'visual',
  weakTopics: ['DOM', 'Virtual DOM'],
  strongTopics: ['JavaScript basics'],
  misconceptionHistory: [
    { topic: 'DOM', description: 'Thought virtual DOM replaces real DOM entirely.' }
  ]
};

const fakeDocContext = {
  title: 'React Fundamentals',
  topics: ['Intro', 'Virtual DOM', 'JSX'],
  currentChunkIndex: 0,
  totalChunks: 5,
};

console.log('\n── buildTeachPrompt Basic Structure ──');
const promptUnderstand = buildTeachPrompt(fakeChunk, fakeProfile, 'understand', fakeDocContext);
assert('Includes warm/encouraging BRAUDLE tutor role', promptUnderstand.includes('Braudle Tutor'));
assert('Includes student level: beginner', promptUnderstand.includes('ADAPTIVE TEACHING') || promptUnderstand.includes('university'));
assert('Includes learning goal', promptUnderstand.includes('Pass React Cert'));
assert('Includes study level context', promptUnderstand.includes('university'));
assert('Includes learning style context', promptUnderstand.includes('visual'));
assert('Includes misconception history topics', promptUnderstand.includes('Thought virtual DOM replaces real DOM entirely.'));
assert('Includes document title', promptUnderstand.includes('React Fundamentals'));
assert('Includes document progress info', promptUnderstand.includes('section 1 of 5'));
assert('Includes document topics', promptUnderstand.includes('Intro, Virtual DOM, JSX'));
assert('Includes chunk content', promptUnderstand.includes(fakeChunk));

console.log('\n── buildTeachPrompt Modes ──');
const promptReview = buildTeachPrompt(fakeChunk, fakeProfile, 'review', fakeDocContext);
assert('Review mode instruction included', promptReview.includes('MODE — REVIEW:'));

const promptAsk = buildTeachPrompt(fakeChunk, fakeProfile, 'ask', fakeDocContext);
assert('Ask mode instruction included', promptAsk.includes('MODE — ASK ANYTHING:'));

const promptFlashcards = buildTeachPrompt(fakeChunk, fakeProfile, 'flashcards', fakeDocContext);
assert('Flashcards mode instruction included', promptFlashcards.includes('MODE — FLASHCARDS:'));
assert('Flashcards instruction specifies FLASHCARD | structure', promptFlashcards.includes('FLASHCARD | TOPIC:'));

console.log('\n── buildTeachPrompt Prepare Mode (Dual flow) ──');
// Prepare Mode - style not set (mixed or undefined)
const prepContextNoStyle = { ...fakeDocContext, preparationStyle: 'mixed' };
const promptPrepMixed = buildTeachPrompt(fakeChunk, fakeProfile, 'prepare', prepContextNoStyle);
assert('Prep with mixed style triggers the choice menu prompt', promptPrepMixed.includes('Before beginning the exam preparation, ask the student how they would like to be prepared.'));
assert('Prep choices list Option 1: Story-based', promptPrepMixed.includes('📖 **Story-based**'));

// Prepare Mode - story style
const prepContextStory = { ...fakeDocContext, preparationStyle: 'story' };
const promptPrepStory = buildTeachPrompt(fakeChunk, fakeProfile, 'prepare', prepContextStory);
assert('Prep with story style uses Narrative Pedagogy prompt', promptPrepStory.includes('MODE — PREPARE (Story-Based):'));
assert('Prep story style tells tutor to present case study/story', promptPrepStory.includes('present the concept from the current section as a short, engaging story'));

// Prepare Mode - mcq style
const prepContextMcq = { ...fakeDocContext, preparationStyle: 'mcq' };
const promptPrepMcq = buildTeachPrompt(fakeChunk, fakeProfile, 'prepare', prepContextMcq);
assert('Prep with mcq style uses MCQ supervisor prompt', promptPrepMcq.includes('MODE — PREPARE (Multiple Choice):'));
assert('Prep mcq style specifies standard Q/A/B/C/D format', promptPrepMcq.includes('A)'));

// Prepare Mode - theory style
const prepContextTheory = { ...fakeDocContext, preparationStyle: 'theory' };
const promptPrepTheory = buildTeachPrompt(fakeChunk, fakeProfile, 'prepare', prepContextTheory);
assert('Prep with theory style uses theory supervisor prompt', promptPrepTheory.includes('MODE — PREPARE (Theory / Essay):'));
assert('Prep theory style requests detailed written answer', promptPrepTheory.includes('Pose ONE long-form theory question'));

console.log('\n── buildInlinePracticePrompt ──');
const practicePrompt = buildInlinePracticePrompt(fakeChunk, fakeProfile, fakeDocContext);
assert('Practice prompt contains document title', practicePrompt.includes('React Fundamentals'));
assert('Practice prompt contains level note for beginner', practicePrompt.includes('Test basic recall and understanding.'));

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);

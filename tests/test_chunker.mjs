/**
 * Test: chunker utility
 * Verifies splitIntoChunks behaviour — paragraph awareness, word limit enforcement,
 * edge cases (empty input, single paragraph, oversized paragraphs).
 */

import { splitIntoChunks } from '../src/utils/chunker.js';

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

console.log('\n── Edge Cases ──');
assert('Empty string → []', JSON.stringify(splitIntoChunks('')) === '[]');
assert('Null → []', JSON.stringify(splitIntoChunks(null)) === '[]');
assert('Whitespace only → []', splitIntoChunks('   ').length === 0);

console.log('\n── Word limit enforcement ──');
// 300 words exactly — should be 1 chunk
const exactly300 = Array(300).fill('word').join(' ');
const oneChunkResult = splitIntoChunks(exactly300, 300);
assert('Exactly 300 words → 1 chunk', oneChunkResult.length === 1,
  `got ${oneChunkResult.length} chunks`);

// 301 words with no paragraph breaks → should be 2 chunks (300 + 1)
const over300 = Array(301).fill('word').join(' ');
const splitResult = splitIntoChunks(over300, 300);
assert('301 words no breaks → 2 chunks', splitResult.length === 2,
  `got ${splitResult.length} chunks`);

console.log('\n── Paragraph awareness ──');
// Two paragraphs each < 300 words, combined < 300 → should merge into 1 chunk
const twoParagraphs = 'First paragraph text.\n\nSecond paragraph text.';
const merged = splitIntoChunks(twoParagraphs, 300);
assert('Two small paragraphs → 1 merged chunk', merged.length === 1,
  `got ${merged.length}`);

// Two paragraphs where each ≈ 200 words → combined 400 > 300 → should be 2 chunks
const para200 = Array(200).fill('word').join(' ');
const twoBigParas = para200 + '\n\n' + para200;
const splitParas = splitIntoChunks(twoBigParas, 300);
assert('Two 200-word paragraphs → 2 chunks (400 > 300)', splitParas.length === 2,
  `got ${splitParas.length}`);

console.log('\n── Chunk content integrity ──');
const textWithContent = 'Hello world.\n\nFoo bar baz.';
const chunks = splitIntoChunks(textWithContent, 300);
assert('Chunk content is non-empty string', chunks.every(c => typeof c === 'string' && c.length > 0));
assert('No chunk contains only whitespace', chunks.every(c => c.trim().length > 0));

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);

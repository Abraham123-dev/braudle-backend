/**
 * Test: scoreCalculator utility
 * Tests calculateScore, determineLevel, shouldUpgradeLevel, calculateXP.
 * No external dependencies — pure logic tests.
 */

import { calculateScore, determineLevel, shouldUpgradeLevel, calculateXP } from '../src/utils/scoreCalculator.js';

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

console.log('\n── calculateScore ──');
assert('All correct → 100', calculateScore([{ isCorrect: true }, { isCorrect: true }]) === 100);
assert('All wrong → 0', calculateScore([{ isCorrect: false }, { isCorrect: false }]) === 0);
assert('1 of 2 correct → 50', calculateScore([{ isCorrect: true }, { isCorrect: false }]) === 50);
assert('3 of 5 correct → 60', calculateScore([
  { isCorrect: true }, { isCorrect: true }, { isCorrect: true },
  { isCorrect: false }, { isCorrect: false }
]) === 60);
assert('Empty array → 0', calculateScore([]) === 0);
assert('Null → 0', calculateScore(null) === 0);

console.log('\n── determineLevel ──');
assert('80 → advanced', determineLevel(80) === 'advanced');
assert('90 → advanced', determineLevel(90) === 'advanced');
assert('100 → advanced', determineLevel(100) === 'advanced');
assert('60 → intermediate', determineLevel(60) === 'intermediate');
assert('79 → intermediate', determineLevel(79) === 'intermediate');
assert('59 → beginner', determineLevel(59) === 'beginner');
assert('0 → beginner', determineLevel(0) === 'beginner');

console.log('\n── shouldUpgradeLevel ──');
assert('Fewer than 3 scores → no upgrade', shouldUpgradeLevel('beginner', [90, 85]) === false);
assert('Average < 80 → no upgrade', shouldUpgradeLevel('beginner', [70, 75, 60]) === false);
assert('Average >= 80, not advanced → upgrade', shouldUpgradeLevel('beginner', [80, 80, 80]) === true);
assert('Average >= 80, intermediate → upgrade', shouldUpgradeLevel('intermediate', [90, 85, 80]) === true);
assert('Already advanced → no upgrade', shouldUpgradeLevel('advanced', [100, 100, 100]) === false);

console.log('\n── calculateXP ──');
assert('Score 90 → base + 50 bonus = 140', calculateXP(90) === 140);
assert('Score 100 → base + 50 bonus = 150', calculateXP(100) === 150);
assert('Score 80 → base + 20 bonus = 100', calculateXP(80) === 100);
assert('Score 89 → base + 20 bonus = 109', calculateXP(89) === 109);
assert('Score 79 → base only = 79', calculateXP(79) === 79);
assert('Score 50 → base only = 50', calculateXP(50) === 50);

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);

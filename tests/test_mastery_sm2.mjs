import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { calculateSM2, recordConceptReview, getDueConcepts } from '../src/services/mastery.service.js';
import MasteryConcept from '../src/models/MasteryConcept.model.js';
import Document from '../src/models/Document.model.js';
import assert from 'assert';

const mockUserId = '60c72b2f9b1d8e2504812345';
const mockDocId = '60c72b2f9b1d8e2504812346';

async function testMasterySM2() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  console.log('\n--- 🧪 Test 1: Math validation of SM-2 Algorithm ---');
  
  // First correct review
  // repetitions=0, EF=2.5, interval=1, quality=4
  const step1 = calculateSM2(4, 0, 1, 2.5);
  console.log('Step 1 (First Correct Review Quality=4):', step1);
  assert.strictEqual(step1.repetitions, 1);
  assert.strictEqual(step1.interval, 1);
  assert.strictEqual(step1.easeFactor, 2.5);

  // Second correct review
  // repetitions=1, EF=2.5, interval=1, quality=4
  const step2 = calculateSM2(4, 1, 1, 2.5);
  console.log('Step 2 (Second Correct Review Quality=4):', step2);
  assert.strictEqual(step2.repetitions, 2);
  assert.strictEqual(step2.interval, 6);
  assert.strictEqual(step2.easeFactor, 2.5);

  // Third correct review with perfect quality=5
  // repetitions=2, EF=2.5, interval=6, quality=5
  const step3 = calculateSM2(5, 2, 6, 2.5);
  console.log('Step 3 (Third Correct Review Quality=5):', step3);
  assert.strictEqual(step3.repetitions, 3);
  assert.strictEqual(step3.interval, 15); // Math.round(6 * 2.5) = 15
  assert(step3.easeFactor > 2.5); // Ease factor should increase for perfect answers

  // Failed review
  // repetitions=3, EF=2.6, interval=15, quality=1 (forgotten)
  const step4 = calculateSM2(1, 3, 15, 2.6);
  console.log('Step 4 (Failed Review Quality=1):', step4);
  assert.strictEqual(step4.repetitions, 0); // repetitions reset
  assert.strictEqual(step4.interval, 1); // interval resets to 1 day
  assert(step4.easeFactor < 2.6); // Ease factor should decrease for bad answers

  console.log('✅ Test 1 Passed: SM-2 math calculations conform to spec.');


  console.log('\n--- 🧪 Test 2: Database mutations and history tracking ---');
  
  // Clean up any existing test records
  await MasteryConcept.deleteMany({ userId: mockUserId });
  await Document.deleteOne({ _id: mockDocId });

  // Create a mock document record
  await Document.create({
    _id: mockDocId,
    userId: mockUserId,
    title: 'Biology Notes',
    type: 'pdf',
    fileUrl: 'https://example.com/bio.pdf',
    fileKey: 'bio.pdf',
    processingStatus: 'ready'
  });

  const conceptName = 'Photosynthesis Light Reactions';

  // Record initial review (Quality=4)
  console.log('Recording Review 1...');
  const rev1 = await recordConceptReview(mockUserId, mockDocId, conceptName, 4);
  console.log('Saved Record 1:', {
    conceptName: rev1.conceptName,
    repetitions: rev1.repetitions,
    interval: rev1.interval,
    easeFactor: rev1.easeFactor,
    box: rev1.box,
    masteryScore: rev1.masteryScore,
    nextReviewDate: rev1.nextReviewDate,
    historyLength: rev1.history.length
  });

  assert.strictEqual(rev1.repetitions, 1);
  assert.strictEqual(rev1.box, 1);
  assert.strictEqual(rev1.masteryScore, 20); // 1 / 5 = 20%
  assert.strictEqual(rev1.history.length, 1);
  assert.strictEqual(rev1.history[0].quality, 4);

  // Record secondary review (Quality=4)
  console.log('Recording Review 2...');
  const rev2 = await recordConceptReview(mockUserId, mockDocId, conceptName, 4);
  console.log('Saved Record 2:', {
    repetitions: rev2.repetitions,
    interval: rev2.interval,
    box: rev2.box,
    masteryScore: rev2.masteryScore,
    historyLength: rev2.history.length
  });

  assert.strictEqual(rev2.repetitions, 2);
  assert.strictEqual(rev2.box, 2);
  assert.strictEqual(rev2.masteryScore, 40); // 2 / 5 = 40%
  assert.strictEqual(rev2.history.length, 2);

  console.log('✅ Test 2 Passed: Spaced repetition updates mutate db correctly.');


  console.log('\n--- 🧪 Test 3: Due items listing ---');

  // Verify concept is NOT due since nextReviewDate was set to +6 days
  const dueNow = await getDueConcepts(mockUserId);
  console.log(`Due concepts count (expected 0): ${dueNow.length}`);
  assert.strictEqual(dueNow.length, 0);

  // Artificially change nextReviewDate to yesterday to mock elapsed time
  await MasteryConcept.updateOne(
    { userId: mockUserId, conceptName },
    { $set: { nextReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
  );

  // Verify it is now due
  const dueLater = await getDueConcepts(mockUserId);
  console.log(`Due concepts count after manual decay simulation (expected 1): ${dueLater.length}`);
  assert.strictEqual(dueLater.length, 1);
  assert.strictEqual(dueLater[0].conceptName, conceptName);

  console.log('✅ Test 3 Passed: Due items scheduler works as expected.');


  console.log('\n--- Cleaning up test records... ---');
  await MasteryConcept.deleteMany({ userId: mockUserId });
  await Document.deleteOne({ _id: mockDocId });
  console.log('Cleanup complete.');

  console.log('Closing database connection...');
  await mongoose.connection.close();
  console.log('Database disconnected successfully.');
  console.log('\n🌟 ALL TESTS PASSED SUCCESSFULLY! 🌟');
}

testMasterySM2().catch(err => {
  console.error('Test execution failed:', err);
  mongoose.connection.close();
  process.exit(1);
});

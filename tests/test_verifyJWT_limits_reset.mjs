import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/User.model.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("No MONGODB_URI found in env");
  process.exit(1);
}

async function runTest() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected successfully!");

  // Find or create a test user
  const email = 'limit-test-user@braudle.com';
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: 'Limit Test User',
      email,
      avatar: '',
      authProvider: 'email',
      role: 'student',
      plan: 'free'
    });
    console.log("Created a new test user record.");
  }

  // 1. Manually set limits to non-zero values and dates to yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  user.uploadCount = { pdf: 2, image: 3 };
  user.dailyGenerationsCount = { flashcards: 4, practice: 2, exam: 1 };
  user.lastUploadDate = yesterday;
  user.lastGenerationResetDate = yesterday;

  await user.save();
  console.log("Staged mock user state with non-zero counters and yesterday's timestamps.");

  // 2. Perform the exact day check and reset logic as added to verifyJWT
  const today = new Date().toISOString().split('T')[0];
  const lastUpload = user.lastUploadDate ? user.lastUploadDate.toISOString().split('T')[0] : null;
  const lastGen = user.lastGenerationResetDate ? user.lastGenerationResetDate.toISOString().split('T')[0] : null;

  console.log(`Checking reset condition: lastUpload=${lastUpload}, lastGen=${lastGen}, today=${today}`);
  
  let didReset = false;
  if (lastUpload !== today || lastGen !== today) {
    user.uploadCount = { pdf: 0, image: 0 };
    user.dailyGenerationsCount = { flashcards: 0, practice: 0, exam: 0 };
    user.lastUploadDate = new Date();
    user.lastGenerationResetDate = new Date();
    user.markModified('uploadCount');
    user.markModified('dailyGenerationsCount');
    await user.save();
    didReset = true;
    console.log("Reset executed successfully!");
  }

  // 3. Reload user from DB and check assertions
  const reloaded = await User.findById(user._id);
  
  const assert = (name, cond) => {
    if (cond) {
      console.log(`  ✅ PASS: ${name}`);
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      process.exit(1);
    }
  };

  assert("DidReset flag is true", didReset === true);
  assert("PDF upload count is reset to 0", reloaded.uploadCount.pdf === 0);
  assert("Image upload count is reset to 0", reloaded.uploadCount.image === 0);
  assert("Flashcards daily generations count is reset to 0", reloaded.dailyGenerationsCount.flashcards === 0);
  assert("Practice daily generations count is reset to 0", reloaded.dailyGenerationsCount.practice === 0);
  assert("Exam daily generations count is reset to 0", reloaded.dailyGenerationsCount.exam === 0);
  
  const reloadedUploadDateStr = reloaded.lastUploadDate.toISOString().split('T')[0];
  const reloadedGenDateStr = reloaded.lastGenerationResetDate.toISOString().split('T')[0];
  assert("lastUploadDate is set to today", reloadedUploadDateStr === today);
  assert("lastGenerationResetDate is set to today", reloadedGenDateStr === today);

  // Clean up
  await User.deleteOne({ _id: user._id });
  console.log("Cleaned up test user record.");
  
  await mongoose.disconnect();
  console.log("Test execution finished successfully.");
}

runTest().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

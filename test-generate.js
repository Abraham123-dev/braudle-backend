import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { generateQuiz } from './src/services/quiz.service.js';
import Document from './src/models/Document.model.js';
import User from './src/models/User.model.js';

dotenv.config();

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected!');

  // Find a failed document
  const document = await Document.findOne({ title: /CPE 204 test prep/i });
  if (!document) {
    console.error('Document not found!');
    await mongoose.disconnect();
    return;
  }
  console.log(`Testing document: ${document.title} (${document._id})`);

  // Find a plus user
  const user = await User.findOne({ email: 'ojewandeabdulfatai2000@gmail.com' });
  if (!user) {
    console.error('User not found!');
    await mongoose.disconnect();
    return;
  }
  console.log(`Testing user: ${user.name} (${user.email}), Plan: ${user.plan}`);

  const profile = { level: 'intermediate' };

  try {
    console.log('\nRunning generateQuiz...');
    const result = await generateQuiz(document._id.toString(), profile, 5, [], 'test-session', [], []);
    console.log('SUCCESS! Generated Quiz count:', result?.length);
    console.log('Questions sample:', JSON.stringify(result?.[0]));
  } catch (err) {
    console.error('\nFAILED during generation:', err);
  }

  await mongoose.disconnect();
  console.log('\nDisconnected.');
}

run();

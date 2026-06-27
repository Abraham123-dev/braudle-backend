import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';

async function listSessions() {
  await connectDB();

  const userId = '6a356b5361ebd4a1d8e93779'; // Oluwaniyi's userId

  try {
    const sessions = await GeneralChatSession.find({ userId });
    console.log(`Found ${sessions.length} sessions for user ${userId}:`);
    
    sessions.forEach((s, index) => {
      console.log(`\nSession ${index + 1}: ID=${s._id}, Title="${s.title}"`);
      console.log(`Messages Count: ${s.messages.length}`);
      console.log(`Images Attached: ${s.imageKnowledge.length}`);
      s.imageKnowledge.forEach(img => {
        console.log(`  - File: "${img.fileName}" (Hash: ${img.imageHash})`);
        console.log(`    Extracted text snippets: "${(img.analysis.extractedText || '').slice(0, 150)}..."`);
      });
      // Print the last 2 messages
      const lastMsgs = s.messages.slice(-2);
      console.log('Last Messages:');
      lastMsgs.forEach(m => console.log(`  [${m.role}]: "${(m.content || '').slice(0, 100)}..."`));
    });

  } catch (err) {
    console.error('Error listing sessions:', err);
  } finally {
    await mongoose.connection.close();
  }
}

listSessions();

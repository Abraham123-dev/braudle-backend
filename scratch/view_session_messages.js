import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';

async function viewSessionMessages() {
  await connectDB();

  const sessionId = '6a3eb17f3f80966dea66b407';

  try {
    const session = await GeneralChatSession.findById(sessionId);
    if (!session) {
      console.log('Session not found.');
      return;
    }

    console.log(`\nSession Title: "${session.title}"`);
    console.log(`Attached Images: ${session.imageKnowledge.length}`);
    session.imageKnowledge.forEach(img => {
      console.log(`- Image: ${img.fileName}, Hash: ${img.imageHash}`);
    });

    console.log('\n--- MESSAGES ---');
    session.messages.forEach((m, i) => {
      console.log(`\nMessage ${i + 1} [${m.role}] (${m.timestamp}):`);
      console.log(m.content);
      if (m.attachments && m.attachments.length > 0) {
        console.log(`Attachments: ${JSON.stringify(m.attachments)}`);
      }
    });

  } catch (err) {
    console.error('Error viewing session:', err);
  } finally {
    await mongoose.connection.close();
  }
}

viewSessionMessages();

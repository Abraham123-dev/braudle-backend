import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';

async function viewSession1() {
  await connectDB();
  try {
    const session = await GeneralChatSession.findById('6a3b4acaade91c6875250146');
    if (!session) {
      console.log('Session 1 not found.');
      return;
    }
    console.log('--- SESSION 1 MESSAGES ---');
    session.messages.forEach((m, i) => {
      console.log(`[${m.role}]: ${m.content.slice(0, 300)}...`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
  }
}

viewSession1();

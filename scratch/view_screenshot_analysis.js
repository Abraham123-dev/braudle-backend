import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';

async function checkAnalysis() {
  await connectDB();
  try {
    const sessions = await GeneralChatSession.find({
      "imageKnowledge.fileName": /130131/i
    });

    console.log(`Found ${sessions.length} sessions containing image matching '143626':`);

    sessions.forEach(s => {
      console.log(`Session: ID=${s._id}, Title="${s.title}"`);
      s.imageKnowledge.forEach(img => {
        console.log(`\nImage Record details:`);
        console.log(`- File Name: "${img.fileName}"`);
        console.log(`- Hash: "${img.imageHash}"`);
        console.log(`- File URL: "${img.fileUrl}"`);
        console.log(`- Analysis:`, JSON.stringify(img.analysis, null, 2));
      });
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
  }
}

checkAnalysis();

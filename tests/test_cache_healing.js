import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';
import { uploadGeneralChatImage } from '../src/controllers/generalChat.controller.js';

const mockUserId = '60c72b2f9b1d8e2504812345';
const imagePath = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\32f7683b-3662-4fb4-94ec-9d735d76cc74\\login_screen_1782406435055.png';

const callController = (controllerFn, req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      setHeader(name, val) {
        this.headers[name] = val;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        this.body = obj;
        resolve(this);
        return this;
      }
    };
    const next = (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    };
    controllerFn(req, res, next);
  });
};

async function runCacheHealingTest() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  console.log('--- Loading test image... ---');
  if (!fs.existsSync(imagePath)) {
    console.error(`Error: Test image not found at ${imagePath}`);
    process.exit(1);
  }
  const imageBuffer = fs.readFileSync(imagePath);
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  console.log(`Image Hash: ${imageHash}`);

  // Clean up any existing image knowledge with this hash to start clean
  console.log('--- Cleaning up any existing sessions with this image hash... ---');
  await GeneralChatSession.deleteMany({ "imageKnowledge.imageHash": imageHash });

  // 1. Create a session with a corrupted image record (empty analysis)
  console.log('\n--- Step 1: Creating session with corrupted (empty) image knowledge ---');
  const session = await GeneralChatSession.create({
    userId: mockUserId,
    title: 'Corrupt Cache Session',
    imageKnowledge: [
      {
        imageHash,
        fileUrl: 'https://fake-url.com/corrupt.png',
        fileKey: 'general-chat/corrupt-key',
        fileName: 'login_screen.png',
        analysis: {
          extractedText: '',
          summary: '',
          questions: [],
          equations: [],
          diagrams: [],
          keyConcepts: [],
          detectedTopics: []
        },
        embeddings: new Array(1536).fill(0)
      }
    ]
  });
  console.log(`Created corrupt session: ${session._id}`);

  try {
    // 2. Call uploadGeneralChatImage which should trigger Cache Healing
    console.log('\n--- Step 2: Uploading image to trigger cache healing ---');
    const reqUpload = {
      user: { id: mockUserId, name: 'Oluwaniyi' },
      params: { id: session._id.toString() },
      file: {
        buffer: imageBuffer,
        mimetype: 'image/png',
        originalname: 'login_screen.png'
      }
    };

    const resUpload = await callController(uploadGeneralChatImage, reqUpload);
    console.log(`Upload Response Status: ${resUpload.statusCode}`);
    
    if (resUpload.statusCode !== 200) {
      throw new Error(`Upload failed with status ${resUpload.statusCode}`);
    }

    const responseBody = resUpload.body;
    console.log(`Healed response summary: "${responseBody.analysis?.summary}"`);

    if (!responseBody.analysis?.summary || responseBody.analysis.summary.trim().length === 0) {
      throw new Error('FAILED: Response contains empty summary! Cache healing did not run or vision failed.');
    }
    console.log('✅ Success: Response has a valid summary.');

    // 3. Verify database healing: Retrieve the session and verify analysis is populated
    console.log('\n--- Step 3: Verifying session record in database has been healed ---');
    const updatedSession = await GeneralChatSession.findById(session._id);
    const healedRecord = updatedSession.imageKnowledge.find(img => img.imageHash === imageHash);

    if (!healedRecord) {
      throw new Error('FAILED: Image record is missing from session after upload!');
    }

    console.log(`DB Record Summary: "${healedRecord.analysis?.summary}"`);
    console.log(`DB Record ExtractedText: "${healedRecord.analysis?.extractedText.substring(0, 50)}..."`);

    if (!healedRecord.analysis?.summary || healedRecord.analysis.summary.trim().length === 0) {
      throw new Error('FAILED: Database record still has an empty summary! Cache was not healed.');
    }
    console.log('✅ Success: Database record successfully healed!');

  } finally {
    console.log('\n--- Cleaning up test session... ---');
    await GeneralChatSession.findByIdAndDelete(session._id);
    console.log('Session deleted.');
    
    console.log('Closing database connection...');
    await mongoose.connection.close();
    console.log('Done.');
  }
}

runCacheHealingTest().catch(err => {
  console.error('Test failed:', err);
  mongoose.connection.close();
  process.exit(1);
});

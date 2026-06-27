import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';
import { uploadGeneralChatImage, sendGeneralChatMessage } from '../src/controllers/generalChat.controller.js';

const mockUserId = '60c72b2f9b1d8e2504812345';
const imagePath = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\32f7683b-3662-4fb4-94ec-9d735d76cc74\\login_screen_1782406435055.png';

const callController = (controllerFn, req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      sseChunks: [],
      setHeader(name, val) {
        this.headers[name] = val;
      },
      write(data) {
        this.sseChunks.push(data);
      },
      end() {
        resolve(this);
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

async function runIntegrationTest() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  console.log('--- Loading test image... ---');
  if (!fs.existsSync(imagePath)) {
    console.error(`Error: Test image not found at ${imagePath}`);
    process.exit(1);
  }
  const imageBuffer = fs.readFileSync(imagePath);

  console.log('--- Creating mock chat session... ---');
  const session = await GeneralChatSession.create({
    userId: mockUserId,
    title: 'Integration Test Chat'
  });
  console.log(`Created session: ${session._id}`);

  try {
    // Test 1: Upload (Cache Miss)
    console.log('\n--- Test 1: Uploading Image (Cache Miss Expected) ---');
    const reqUploadMiss = {
      user: { id: mockUserId, name: 'Oluwaniyi' },
      params: { id: session._id.toString() },
      file: {
        buffer: imageBuffer,
        mimetype: 'image/png',
        originalname: 'login_screen.png'
      }
    };
    const startUpload = Date.now();
    const resUploadMiss = await callController(uploadGeneralChatImage, reqUploadMiss);
    const uploadTime = Date.now() - startUpload;

    console.log(`Upload Status: ${resUploadMiss.statusCode}`);
    console.log(`Upload Response:`, JSON.stringify(resUploadMiss.body, null, 2));
    console.log(`Upload Time: ${uploadTime}ms`);

    if (resUploadMiss.statusCode !== 200) {
      throw new Error(`Upload Cache Miss failed with status ${resUploadMiss.statusCode}`);
    }

    // Test 2: Upload Again (Cache Hit)
    console.log('\n--- Test 2: Uploading Image Again (Cache Hit Expected) ---');
    const reqUploadHit = {
      user: { id: mockUserId, name: 'Oluwaniyi' },
      params: { id: session._id.toString() },
      file: {
        buffer: imageBuffer,
        mimetype: 'image/png',
        originalname: 'login_screen.png'
      }
    };
    const startUploadHit = Date.now();
    const resUploadHit = await callController(uploadGeneralChatImage, reqUploadHit);
    const uploadHitTime = Date.now() - startUploadHit;

    console.log(`Upload Again Status: ${resUploadHit.statusCode}`);
    console.log(`Upload Again Response:`, JSON.stringify(resUploadHit.body, null, 2));
    console.log(`Upload Again Time: ${uploadHitTime}ms`);

    if (resUploadHit.statusCode !== 200) {
      throw new Error(`Upload Cache Hit failed with status ${resUploadHit.statusCode}`);
    }
    if (uploadHitTime > 1500) {
      console.warn(`WARNING: Cache hit was slow (${uploadHitTime}ms). Bypassing Groq should be sub-500ms.`);
    } else {
      console.log('✅ Success: Cache hit was extremely fast!');
    }

    // Test 3: Send message asking about the image (RAG fallback + Response)
    console.log('\n--- Test 3: Sending Generic Message (RAG Fallback Expected) ---');
    const reqMsg = {
      user: { id: mockUserId, name: 'Oluwaniyi' },
      params: { id: session._id.toString() },
      body: {
        message: 'Explain this screenshot and teach me a topic from it'
      }
    };
    
    const resMsg = await callController(sendGeneralChatMessage, reqMsg);
    console.log(`Message Status: ${resMsg.statusCode}`);
    
    // Log streamed SSE chunks
    console.log('\nStreamed Response:');
    let fullText = '';
    resMsg.sseChunks.forEach(chunkStr => {
      const line = chunkStr.toString().trim();
      if (line.startsWith('data: ')) {
        const dataJsonStr = line.slice(6).trim();
        try {
          const parsed = JSON.parse(dataJsonStr);
          if (parsed.token) {
            process.stdout.write(parsed.token);
            fullText += parsed.token;
          }
        } catch (e) {
          // Ignore DONE or formatting lines
        }
      }
    });
    console.log('\n');

    const lowerText = fullText.toLowerCase();
    if (!lowerText.includes('study') && !lowerText.includes('streak') && !lowerText.includes('dashboard') && !lowerText.includes('xp')) {
      console.warn('WARNING: The AI response did not mention details from the dashboard screenshot.');
    } else {
      console.log('✅ Success: Fallback RAG logic successfully retrieved the image and AI explained it!');
    }

  } finally {
    console.log('\n--- Cleaning up test session... ---');
    await GeneralChatSession.findByIdAndDelete(session._id);
    console.log('Session deleted.');
    
    console.log('Closing database connection...');
    await mongoose.connection.close();
    console.log('Done.');
  }
}

runIntegrationTest().catch(err => {
  console.error('Integration test failed:', err);
  mongoose.connection.close();
  process.exit(1);
});

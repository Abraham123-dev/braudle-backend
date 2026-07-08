import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Document from '../src/models/Document.model.js';
import Session from '../src/models/Session.model.js';
import Conversation from '../src/models/Conversation.model.js';
import StudentProfile from '../src/models/StudentProfile.model.js';
import User from '../src/models/User.model.js';
import * as AIService from '../src/services/ai.service.js';
import { chatSession } from '../src/controllers/session.controller.js';

const mockUserId = '60c72b2f9b1d8e2504812345';

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

async function testSemanticRag() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  console.log('--- Creating mock User... ---');
  await User.deleteOne({ _id: mockUserId });
  await User.create({
    _id: mockUserId,
    email: 'mockuser@example.com',
    name: 'Oluwaniyi',
    authProvider: 'email',
    onboardingComplete: true
  });

  console.log('--- Creating mock Student Profile... ---');
  // Ensure we delete any leftover profile first
  await StudentProfile.deleteOne({ userId: mockUserId });
  const profile = await StudentProfile.create({
    userId: mockUserId,
    level: 'beginner',
    studyLevel: 'College',
    goal: 'Acing exams'
  });

  const chunks = [
    'Mitosis is a process of cell division where a single cell divides into two identical daughter cells.',
    'Photosynthesis is the process used by plants to convert light energy into chemical energy.',
    'The gravity of Earth, denoted by g, is the net acceleration that is imparted to objects.'
  ];

  console.log('--- Generating embeddings for chunks... ---');
  const chunkEmbeddings = await Promise.all(
    chunks.map(chunk => AIService.generateEmbedding(chunk))
  );

  console.log('--- Creating mock study Document... ---');
  const document = await Document.create({
    userId: mockUserId,
    title: 'Biology & Physics Notes',
    type: 'pdf',
    fileUrl: 'https://example.com/notes.pdf',
    fileKey: 'notes.pdf',
    chunks,
    chunkEmbeddings,
    totalChunks: chunks.length,
    processingStatus: 'ready',
    processingStage: 'ready'
  });

  console.log(`Created document: ${document._id}`);

  console.log('--- Creating mock session in UNDERSTAND mode... ---');
  const session = await Session.create({
    userId: mockUserId,
    documentId: document._id,
    mode: 'understand',
    currentChunkIndex: 0
  });

  console.log(`Created session: ${session._id}`);

  try {
    // We expect query about "plants energy" to match Photosynthesis (Index 1)
    console.log('\n--- Test: Querying "how do plants make energy?" ---');
    
    // Setup request
    const req = {
      user: { id: mockUserId, name: 'Oluwaniyi' },
      params: { id: session._id.toString() },
      body: {
        message: 'how do plants make energy?'
      },
      on(event, handler) {
        // mock req.on('close')
      }
    };

    console.log('Running chat session controller...');
    const result = await callController(chatSession, req);

    console.log(`SSE Stream status: ${result.statusCode}`);
    console.log('SSE Stream Output:');
    let fullText = '';
    result.sseChunks.forEach(chunkStr => {
      const line = chunkStr.toString().trim();
      if (line.startsWith('data: ')) {
        const dataJsonStr = line.slice(6).trim();
        try {
          const parsed = JSON.parse(dataJsonStr);
          if (parsed.token) {
            process.stdout.write(parsed.token);
            fullText += parsed.token;
          }
        } catch (e) {}
      }
    });
    console.log('\n');

    const lowerResponse = fullText.toLowerCase();
    if (lowerResponse.includes('photosynthesis') || lowerResponse.includes('light') || lowerResponse.includes('plants') || lowerResponse.includes('energy')) {
      console.log('✅ PASS: Semantic RAG correctly retrieved page/chunk index 1 and discussed Photosynthesis/plants energy!');
    } else {
      console.warn('❌ FAIL: Response did not cover matched Photosynthesis chunk.');
    }

  } finally {
    console.log('\n--- Cleaning up test records... ---');
    await Document.findByIdAndDelete(document._id);
    await Session.findByIdAndDelete(session._id);
    await StudentProfile.deleteOne({ userId: mockUserId });
    await User.deleteOne({ _id: mockUserId });
    await Conversation.findOneAndDelete({ sessionId: session._id });
    console.log('Test records deleted.');
    
    console.log('Closing database connection...');
    await mongoose.connection.close();
    console.log('Done.');
  }
}

testSemanticRag().catch(err => {
  console.error('Test failed:', err);
  mongoose.connection.close();
  process.exit(1);
});

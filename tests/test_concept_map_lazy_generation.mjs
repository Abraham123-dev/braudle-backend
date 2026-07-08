import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Document from '../src/models/Document.model.js';
import { getDocumentConceptMap } from '../src/controllers/document.controller.js';

async function testConceptMap() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  console.log('\n--- 🧪 Fetching a document to test concept map... ---');
  const document = await Document.findOne({ processingStatus: 'ready' });
  if (!document) {
    console.log('No completed documents found in database. Skipping test.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Testing Document: "${document.title}" (${document._id})`);
  
  // Force reset conceptMap to test the lazy LLM generation fallback path!
  document.conceptMap = null;
  await document.save();
  console.log('Force-cleared conceptMap from document to test lazy generation fallback path.');
  console.log('Has existing conceptMap:', !!document.conceptMap);
  
  const cache = document.knowledgeCache || {};
  console.log('Cached Concepts in DB:', (cache.concepts || []).map(c => c.name));
  console.log('Cached ExamTopics in DB:', cache.examTopics || []);

  // Mock req and res objects
  const req = {
    user: { id: document.userId.toString() },
    params: { id: document._id.toString() }
  };

  const responsePromise = new Promise((resolve) => {
    const res = {
      statusCode: null,
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        resolve({ code: this.statusCode, data });
        return this;
      }
    };
    
    // Invoke controller
    getDocumentConceptMap(req, res, (err) => {
      console.error('Next middleware called with error:', err);
      resolve({ err });
    });
  });

  const response = await responsePromise;
  console.log('Response Status:', response.code);
  if (response.data) {
    console.log('Response Concept Map Title:', response.data.conceptMap?.title);
    console.log('Number of Chapters:', response.data.conceptMap?.chapters?.length);
    if (response.data.conceptMap?.chapters?.length > 0) {
      console.log('First Chapter concepts:', response.data.conceptMap.chapters[0].concepts?.map(c => c.name));
    }
  }

  console.log('--- Test Completed Successfully ---');
  await mongoose.disconnect();
}

testConceptMap().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

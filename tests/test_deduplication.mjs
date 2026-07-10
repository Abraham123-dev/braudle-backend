import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import Document from '../src/models/Document.model.js';
import User from '../src/models/User.model.js';
import { uploadDocument } from '../src/controllers/document.controller.js';

async function testDeduplication() {
  console.log('--- Connecting to database... ---');
  await connectDB();

  // Create a mock user to avoid limit failures
  const mockUser = await User.create({
    name: 'Mitosis Test User',
    email: `test-${Date.now()}@braudle.edu`,
    password: 'password123',
    role: 'student',
    plan: 'free',
    uploadCount: { pdf: 0, image: 0 }
  });

  const buffer = Buffer.from('Unique study material content for caching test: cell division mitosis.');
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  console.log(`Generated file buffer hash: ${fileHash}`);

  // Create primary mock completed document
  const primaryDoc = await Document.create({
    userId: mockUser._id,
    title: 'Cell Mitosis Lecture Notes',
    subject: 'Biology',
    type: 'pdf',
    fileUrl: 'https://fake-r2-domain.com/mitosis.pdf',
    fileKey: 'uploads/shared/mitosis-file-key',
    fileHash,
    processingStatus: 'ready',
    processingStage: 'ready',
    knowledgeCacheStatus: 'ready',
    rawText: 'Mitosis is a part of the cell cycle where replicated chromosomes are separated...',
    chunks: ['Mitosis is a part...'],
    topics: ['Mitosis', 'Cell Cycle'],
    summary: 'Mitosis notes.',
    knowledgeCache: {
      concepts: [{ name: 'Mitosis', explanation: 'Cell division.' }]
    }
  });

  console.log('✅ Created primary document cache entry.');

  // Test 1: Upload exact duplicate document (simulate uploadDocument)
  const req = {
    user: { id: mockUser._id.toString() },
    file: {
      originalname: 'Duplicate Mitosis.pdf',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer
    },
    body: {
      title: 'Duplicate Mitosis Notes',
      subject: 'Biology'
    }
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

    uploadDocument(req, res, (err) => {
      resolve({ err });
    });
  });

  console.log('\n--- 🧪 Triggering duplicate file upload... ---');
  const response = await responsePromise;

  if (response.err) {
    throw response.err;
  }

  console.log('Response status code:', response.code);
  console.log('Response body:', response.data);

  // Assertions
  if (response.code !== 200) {
    throw new Error(`Expected status 200 but got ${response.code}`);
  }

  if (response.data.status !== 'ready') {
    throw new Error(`Expected status to be "ready" but got "${response.data.status}"`);
  }

  // Fetch the newly created document copy from DB
  const duplicateDoc = await Document.findById(response.data.documentId);
  if (!duplicateDoc) {
    throw new Error('Duplicate document record was not found in database');
  }

  console.log('\nVerifying copied metadata fields on duplicate document:');
  console.log('Duplicate Status:', duplicateDoc.processingStatus);
  console.log('Copied File Key:', duplicateDoc.fileKey);
  console.log('Copied Topics:', duplicateDoc.topics);
  console.log('Copied Cache Concepts:', duplicateDoc.knowledgeCache?.concepts?.map(c => c.name));

  if (duplicateDoc.processingStatus !== 'ready') {
    throw new Error('Duplicate document was not marked as ready instantly');
  }
  if (duplicateDoc.topics.length === 0 || duplicateDoc.topics[0] !== 'Mitosis') {
    throw new Error('Failed to copy topics correctly');
  }
  if (duplicateDoc.fileKey !== primaryDoc.fileKey) {
    throw new Error('Duplicate document does not point to the original fileKey');
  }

  console.log('✅ Test 1: Ingestion Caching and Copying succeeded.');

  // Test 2: Deletion isolation
  console.log('\n--- 🧪 Testing deletion isolation... ---');
  await primaryDoc.deleteOne();
  console.log('Primary document deleted.');

  const duplicateCheck = await Document.findById(duplicateDoc._id);
  if (!duplicateCheck) {
    throw new Error('Duplicate document was deleted when primary was deleted');
  }

  console.log('Duplicate Doc Topics post-primary deletion:', duplicateCheck.topics);
  if (duplicateCheck.processingStatus !== 'ready') {
    throw new Error('Duplicate document was corrupted/invalidated post primary deletion');
  }

  console.log('✅ Test 2: Deletion Isolation succeeded.');

  // Cleanup database
  await duplicateDoc.deleteOne();
  await mockUser.deleteOne();

  console.log('\n--- 🎉 All Deduplication Tests Passed Successfully! ---');
  await mongoose.disconnect();
}

testDeduplication().catch(async (err) => {
  console.error('❌ Test failed:', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

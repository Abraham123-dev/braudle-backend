import dotenv from 'dotenv';
dotenv.config();

import * as AIService from '../src/services/ai.service.js';
import { getDetailedSummary } from '../src/controllers/session.controller.js';
import Document from '../src/models/Document.model.js';
import Session from '../src/models/Session.model.js';

// Setup Mock models
Session.findOne = async () => {
  return {
    _id: 'mock_session_1',
    userId: 'mock_user_1',
    documentId: 'mock_document_1',
    mode: 'understand',
    currentChunkIndex: 0,
  };
};

Document.findById = async () => {
  return {
    _id: 'mock_document_1',
    title: 'Cell Division Textbook',
    rawText: 'Mitosis is the process of cell division. It has four stages: prophase, metaphase, anaphase, and telophase. During prophase chromatin condenses.',
    chunks: [
      'Mitosis is the process of cell division.',
      'It has four stages: prophase, metaphase, anaphase, and telophase.',
      'During prophase chromatin condenses.'
    ],
    detailedSummary: '',
    save: async function() {
      this.saved = true;
    }
  };
};

async function runMockTest() {
  console.log('--- Testing getDetailedSummary controller logic ---');
  
  const req = {
    params: { id: 'mock_session_1' },
    user: { id: 'mock_user_1' }
  };

  const res = {
    statusCode: 200,
    body: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(obj) {
      this.body = obj;
      return this;
    }
  };

  const next = (err) => {
    if (err) {
      console.error('Controller triggered error:', err);
    }
  };

  // We should mock generateAIResponse since we do not have external API keys connected
  const originalGenerateAIResponse = AIService.generateAIResponse;
  AIService.generateAIResponse = async () => {
    return '# Summary Mock\n* Key Concept: Mitosis cell division.';
  };

  try {
    await getDetailedSummary(req, res, next);
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', res.body);

    if (res.body && res.body.status === 'success' && res.body.detailedSummary.includes('Mitosis')) {
      console.log('✅ PASS: getDetailedSummary controller generates and returns detailed summary!');
    } else {
      console.log('❌ FAIL: getDetailedSummary did not produce expected output.');
    }
  } catch (err) {
    console.error('Test execution failed:', err);
  } finally {
    AIService.generateAIResponse = originalGenerateAIResponse;
  }
}

runMockTest();

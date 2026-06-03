import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import StudentProfile from '../models/StudentProfile.model.js';
import Conversation from '../models/Conversation.model.js';
import { buildTeachPrompt } from '../utils/promptBuilder.js';
import * as AIService from '../services/ai.service.js';

/**
 * Starts a new learning session for a specific document
 */
export const startSession = asyncHandler(async (req, res) => {
  const { documentId, mode } = req.body;
  const userId = req.user.id;

  // 1. Verify document exists, belongs to user, and is processed
  const document = await Document.findOne({ _id: documentId, userId });
  if (!document) throw new AppError('Document not found', 404);
  if (document.processingStatus !== 'ready') {
    throw new AppError('Document is still being processed. Please wait.', 400);
  }

  // 2. Mark any other active sessions for this document as 'abandoned'
  await Session.updateMany(
    { userId, documentId, status: 'active' },
    { status: 'abandoned' }
  );

  // 3. Create the session
  const session = await Session.create({
    userId,
    documentId,
    mode: mode || 'teach',
    currentChunkIndex: 0,
  });

  // 4. Initialize empty conversation
  await Conversation.create({
    sessionId: session._id,
    userId,
    messages: [],
  });

  res.status(201).json({
    status: 'success',
    sessionId: session._id,
    mode: session.mode,
    message: 'Session started. You can now begin the chat.',
  });
});

/**
 * Handles real-time AI teaching via Server-Sent Events (SSE)
 */
export const chatSession = asyncHandler(async (req, res) => {
  const { id: sessionId } = req.params;
  const { message } = req.body;
  const userId = req.user.id;

  // 1. Get Session and associated data
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session || session.status !== 'active') {
    throw new AppError('Session not found or inactive', 404);
  }

  const document = await Document.findById(session.documentId);
  if (!document) throw new AppError('Document not found', 404);

  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError('Student profile not found', 404);

  const conversation = await Conversation.findOne({ sessionId });
  if (!conversation) throw new AppError('Conversation not found', 404);

  // 2. Prepare Context (Current chunk + History)
  const currentChunk = (document.chunks && document.chunks[session.currentChunkIndex]) || '';
  const history = conversation.messages.slice(-10); // Last 5 exchanges

  // 3. Build Prompt
  const systemPrompt = buildTeachPrompt(currentChunk, profile, session.mode);

  // 4. Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullAIResponse = '';

  try {
    // 5. Stream from AI Service (Groq)
    const stream = await AIService.streamGroq(systemPrompt, message, history);

    for await (const part of stream) {
      const chunkValue = part.choices[0]?.delta?.content || '';
      if (chunkValue) {
        fullAIResponse += chunkValue;
        res.write(`data: ${JSON.stringify({ token: chunkValue })}\n\n`);
      }
    }

    // 6. Signal completion
    res.write('data: [DONE]\n\n');
    res.end();

    // 7. Persist conversation after successful stream
    conversation.messages.push(
      { role: 'user', content: message },
      { role: 'assistant', content: fullAIResponse }
    );
    await conversation.save();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'AI Stream interrupted' })}\n\n`);
    res.end();
  }
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, userId: req.user.id })
    .populate('documentId', 'title subject');
  
  if (!session) throw new AppError('Session not found', 404);
  
  const conversation = await Conversation.findOne({ sessionId: session._id });

  res.status(200).json({ session, messages: conversation?.messages || [] });
});

export const completeSession = asyncHandler(async (req, res) => {
  const session = await Session.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { status: 'completed', completedAt: new Date() },
    { new: true }
  );

  if (!session) throw new AppError('Session not found', 404);

  res.status(200).json({ status: 'success', message: 'Session marked as completed' });
});

/**
 * Allows the student to switch modes or move to next chunk based on Mentor suggestions
 */
export const updateSessionState = asyncHandler(async (req, res) => {
  const { id: sessionId } = req.params;
  const { mode, currentChunkIndex, mentorSuggestion } = req.body;
  const userId = req.user.id;

  const update = {};
  const set = {};
  if (mode) set.mode = mode;
  if (typeof currentChunkIndex === 'number') set.currentChunkIndex = currentChunkIndex;
  
  if (Object.keys(set).length > 0) update.$set = set;
  if (mentorSuggestion) update.$push = { mentorSuggestions: mentorSuggestion };

  const session = await Session.findOneAndUpdate(
    { _id: sessionId, userId, status: 'active' },
    update,
    { new: true }
  );

  if (!session) throw new AppError('Active session not found', 404);

  res.status(200).json({ status: 'success', session });
});
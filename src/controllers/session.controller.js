import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import StudentProfile from '../models/StudentProfile.model.js';
import Conversation from '../models/Conversation.model.js';
import { buildTeachPrompt } from '../utils/promptBuilder.js';
import * as AIService from '../services/ai.service.js';
import * as AdaptationService from '../services/adaptation.service.js';
import * as ProfileService from '../services/profile.service.js';
import { getCached, setCached, deleteCached, CACHE_KEYS, CACHE_TTL } from '../utils/cache.js';

/**
 * Starts a new learning session for a specific document
 */
export const startSession = asyncHandler(async (req, res) => {
  const { documentId, mode } = req.body;
  const userId = req.user.id;

  // 1. Verify document exists, belongs to user, and is processed
  const document = await Document.findOne({ _id: documentId, userId });
  if (!document) throw new AppError('Document not found', 404);
  if (document.userId.toString() !== userId) throw new AppError('Forbidden: Access denied', 403);
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

  // Concurrent Stream Protection
  const streamLockKey = CACHE_KEYS.ACTIVE_STREAM(userId);
  const activeStream = await getCached(streamLockKey);
  if (activeStream) throw new AppError('Only one active tutoring stream allowed at a time', 429);

  // 1. Get Session and associated data
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session || session.status !== 'active') {
    throw new AppError('Forbidden: Access denied or session inactive', 403);
  }
  const document = await Document.findById(session.documentId);
  if (!document) throw new AppError('Document not found', 404);

  // Cache-aware profile fetch — avoids a MongoDB hit on every chat message
  const profile = await ProfileService.getProfile(userId);
  if (!profile) throw new AppError('Student profile not found', 404);

  // Conversation Null Safety
  let conversation = await Conversation.findOne({ sessionId });
  if (!conversation) {
    conversation = await Conversation.create({ sessionId, userId, messages: [] });
  }

  // 2. Prepare Context (Current chunk + History)
  const currentChunk = (document.chunks && document.chunks[session.currentChunkIndex]) || '';
  const history = (conversation.messages || []).slice(-10); // Last 5 exchanges

  // Expensive AI Cache Check
  const cacheKey = CACHE_KEYS.TEACH(document._id, session.currentChunkIndex, profile.level);
  const cachedResponse = await getCached(cacheKey);
  
  // 4. Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Lock the stream
  await setCached(streamLockKey, sessionId, CACHE_TTL.STREAM);

  // 3. Build Prompt
  const systemPrompt = buildTeachPrompt(currentChunk, profile, session.mode);

  let fullAIResponse = '';
  let isClosed = false;
  let stream;

  req.on('close', () => {
    isClosed = true;
    deleteCached(streamLockKey);
    if (stream?.abort) stream.abort();
  });

  try {
    if (cachedResponse && message === 'ready') {
      fullAIResponse = cachedResponse;
      res.write(`data: ${JSON.stringify({ token: cachedResponse })}\n\n`);
    } else {
    // 5. Stream from AI Service (Groq)
    stream = await AIService.streamGroq(systemPrompt, message, history);

    for await (const part of stream) {
      if (isClosed) break;
      const chunkValue = part.choices[0]?.delta?.content || '';
      if (chunkValue) {
        fullAIResponse += chunkValue;
        res.write(`data: ${JSON.stringify({ token: chunkValue })}\n\n`);
      }
    }
    }

    // 6. Signal completion
    res.write('data: [DONE]\n\n');
    res.end();

    // Cache costly response
    if (!cachedResponse) await setCached(cacheKey, fullAIResponse, CACHE_TTL.TEACH || 86400);

    // 7. Persist conversation after successful stream
    conversation.messages.push(
      { role: 'user', content: message },
      { role: 'assistant', content: fullAIResponse }
    );
    await conversation.save();
    await deleteCached(streamLockKey);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'AI Stream interrupted' })}\n\n`);
    res.end();
    await deleteCached(streamLockKey);
  }
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, userId: req.user.id })
    .populate('documentId', 'title subject');
  
  if (!session) throw new AppError('Session not found', 404);
  if (session.userId.toString() !== req.user.id) throw new AppError('Forbidden: Access denied', 403);
  
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

  // Background task: Extract summary and misconceptions from chat transcript
  AdaptationService.extractSessionInsights(session._id);

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

/**
 * Returns a personalised AI tutor welcome for a freshly opened session.
 * Uses topics + summary extracted by the background worker.
 * The frontend renders this as the first message in the chat window.
 */
export const getWelcomeMessage = asyncHandler(async (req, res) => {
  const { id: sessionId } = req.params;
  const userId = req.user.id;

  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError('Session not found', 404);

  const document = await Document.findById(session.documentId)
    .select('title topics summary');
  if (!document) throw new AppError('Document not found', 404);

  const profile = await ProfileService.getProfile(userId);
  if (!profile) throw new AppError('Student profile not found', 404);

  // Name comes from verifyJWT — no extra DB query needed
  const name = req.user.name === 'New Student' ? '' : req.user.name;
  const firstName = name?.split(' ')[0] || 'there';

  const topics = document.topics || [];
  const summary = document.summary || '';

  // Build the welcome message text
  let welcomeText = `Hi ${firstName}! 👋\n\nI've finished studying your **${document.title}** notes.`;

  if (topics.length > 0) {
    welcomeText += `\n\nI found **${topics.length} key topic${topics.length > 1 ? 's' : ''}**:\n`;
    welcomeText += topics.map(t => `• ${t}`).join('\n');
  }

  if (summary) {
    welcomeText += `\n\n${summary}`;
  }

  welcomeText += `\n\nWhat would you like to do next?`;

  // The 6 available learning modes
  const learningModes = [
    { id: 'breakdown',  label: 'Break It Down',        description: 'Simplify difficult concepts with analogies and clear language.' },
    { id: 'teach',      label: 'Explain Like I\'m New', description: 'Teach from first principles with step-by-step guidance.' },
    { id: 'chat',       label: 'Quick Insights',        description: 'Get key takeaways and ask specific questions freely.' },
    { id: 'quiz',       label: 'Quiz Me',               description: 'Generate questions to test your knowledge of this document.' },
    { id: 'exam',       label: 'Practice Exam',         description: 'Simulate exam conditions with no hints or encouragement.' },
    { id: 'ask',        label: 'Ask Anything',          description: 'Free-form chat — ask whatever you want about this material.' },
  ];

  res.status(200).json({
    status: 'success',
    welcome: {
      message: welcomeText,
      topics,
      summary,
      documentTitle: document.title,
      learningModes,
    },
  });
});
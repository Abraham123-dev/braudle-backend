import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import GeneralChatSession from '../models/GeneralChatSession.model.js';
import GeneralChatUsage from '../models/GeneralChatUsage.model.js';
import * as AIService from '../services/ai.service.js';
import * as ProfileService from '../services/profile.service.js';

/**
 * Token calculation/estimation helper
 * Standard rule of thumb: ~4 characters in English equal 1 token
 */
const estimateTokens = (text) => {
  if (!text) return 0;
  if (typeof text === 'number') {
    return Math.ceil(text / 4);
  }
  return Math.ceil(text.trim().length / 4);
};

/**
 * Check if the 12-hour token budget window has expired and reset if needed
 */
const handleTokenResetIfNeeded = async (usage) => {
  const now = new Date();
  const resetWindowMs = 12 * 60 * 60 * 1000; // 12 hours
  if (now.getTime() - new Date(usage.lastResetAt).getTime() >= resetWindowMs) {
    usage.tokensUsed = 0;
    usage.inputTokens = 0;
    usage.outputTokens = 0;
    usage.lastResetAt = now;
    await usage.save();
  }
  return usage;
};

/**
 * Retrieve all chat sessions and global lock status for the logged-in user.
 */
export const getGeneralChat = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // 1. Fetch user's chat sessions sorted by latest update
  const sessions = await GeneralChatSession.find({ userId }).sort({ updatedAt: -1 });

  // 2. Fetch or create user's global limit tracking
  let usage = await GeneralChatUsage.findOne({ userId });
  if (!usage) {
    usage = await GeneralChatUsage.create({ userId });
  }

  // 3. Reset limits if 12h window has elapsed
  usage = await handleTokenResetIfNeeded(usage);

  const remainingTokens = Math.max(0, 20000 - usage.tokensUsed);
  const isLocked = usage.tokensUsed >= 20000;

  return res.status(200).json({
    status: 'success',
    sessions: sessions.map((s) => ({
      id: s._id,
      title: s.title,
      updatedAt: s.updatedAt,
    })),
    usage: {
      tokensUsed: usage.tokensUsed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      remainingTokens,
      isLocked,
    },
  });
});

/**
 * Create a new general chat session.
 */
export const createGeneralChatSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const session = await GeneralChatSession.create({
    userId,
    title: 'New Chat',
    messages: [],
  });

  return res.status(201).json({
    status: 'success',
    session: {
      id: session._id,
      title: session.title,
      updatedAt: session.updatedAt,
    },
  });
});

/**
 * Get messages and title of a specific general chat session.
 */
export const getGeneralChatSessionMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const session = await GeneralChatSession.findOne({ _id: id, userId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  // Count user messages in this session
  const userMsgCount = session.messages.filter((m) => m.role === 'user').length;
  const isConversationLocked = userMsgCount >= 15;

  return res.status(200).json({
    status: 'success',
    session: {
      id: session._id,
      title: session.title,
      messages: session.messages,
      updatedAt: session.updatedAt,
      isLocked: isConversationLocked,
    },
  });
});

/**
 * Send a message inside a specific chat session (image-only attachments, Mistral gateway).
 */
export const sendGeneralChatMessage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { message } = req.body;

  // 1. Find the session
  const session = await GeneralChatSession.findOne({ _id: id, userId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  // Record study activity (streak, total sessions, etc.)
  await ProfileService.recordStudyActivity(userId).catch(err => console.error('[GENERAL CHAT] Failed to record study activity:', err));

  // 2. Fetch or create usage limits
  let usage = await GeneralChatUsage.findOne({ userId });
  if (!usage) {
    usage = await GeneralChatUsage.create({ userId });
  }

  // 3. Reset limits if 12h window has elapsed
  usage = await handleTokenResetIfNeeded(usage);

  // 4. Enforce global token limit
  if (usage.tokensUsed >= 20000) {
    return res.status(403).json({
      status: 'error',
      code: 'TOKEN_LIMIT_EXCEEDED',
      message: "You've used all of your AI chat access for now. Come back later when it resets, or upgrade for more AI access."
    });
  }

  // 5. Enforce conversation message limit (15 user messages)
  const userMsgCount = session.messages.filter((m) => m.role === 'user').length;
  if (userMsgCount >= 15) {
    return res.status(403).json({
      status: 'error',
      code: 'CONVERSATION_LIMIT_EXCEEDED',
      message: "You've reached the limit for this conversation. Start a new chat to keep going, or upgrade for longer conversations and more AI access."
    });
  }

  let extractedText = '';
  let attachmentData = null;

  // 6. File attachments parsing - restrict strictly to images
  if (req.file) {
    const isImage = req.file.mimetype.startsWith('image/');
    if (!isImage) {
      throw new AppError('Only image uploads are allowed in General Chat. PDFs can be studied in your Library.', 400);
    }

    const fileName = req.file.originalname || 'image.png';

    try {
      // Vision OCR
      const base64 = req.file.buffer.toString('base64');
      extractedText = await AIService.transcribeImage(base64, req.file.mimetype);
      console.log(`[GENERAL CHAT] Image transcribed successfully. Extracted length: ${extractedText?.length || 0}`);

      if (extractedText && extractedText.trim().length > 0) {
        attachmentData = {
          name: fileName,
          fileType: 'image',
          extractedText,
        };
      }
    } catch (err) {
      console.error('[GENERAL CHAT] Failed to parse image attachment:', err.message);
      throw new AppError(`Failed to extract text from image: ${err.message}`, 400);
    }
  }

  // 7. Format prompt with extracted text context
  let fullUserContent = message || '';
  if (attachmentData && extractedText) {
    fullUserContent = `[Attached Image: ${attachmentData.name}]\n\nExtracted content:\n"""\n${extractedText.slice(0, 10000)}\n"""\n\nUser Question:\n${fullUserContent}`;
  }

  // 8. Map last 15 messages for short-term chat context
  const recentHistory = session.messages.slice(-15).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemInstructions = 
    'You are Braudle, an expert learning assistant that is ready to help with anything within the learning space. ' +
    'Focus your answers on educational guidance, explanation of concepts, problem-solving, and study support. ' +
    'Explain things step-by-step and clearly, tailoring details to the student\'s level. ' +
    'Keep formatting clean and utilize Markdown for readability.\n\n' +
    'MATHEMATICAL FORMULAS RULES:\n' +
    'When displaying mathematical expressions, you MUST follow these guidelines:\n' +
    '1. Always write equations in LaTeX format.\n' +
    '2. Use display math for important formulas: $$ ... $$ (on its own line, centered).\n' +
    '3. Use inline math for short expressions: $ ... $\n' +
    '4. Use proper LaTeX commands for fractions (\\frac{a}{b}), square roots (\\sqrt{x}), powers (x^2), integrals (\\int_a^b), summations (\\sum_{i=1}^{n}), matrices (\\begin{bmatrix} ... \\end{bmatrix}), etc.\n' +
    '5. Explain every step in plain language before showing the next equation.\n' +
    '6. Never output ASCII-style or raw unicode math (like ∮, ε_0, ⋅) when LaTeX can be used.\n' +
    '7. For multi-step solutions, separate each step onto its own line.';

  const apiMessages = [
    { role: 'system', content: systemInstructions },
    ...recentHistory,
    { role: 'user', content: fullUserContent },
  ];

  // Calculate pre-chat input tokens
  const inputCharCount = apiMessages.reduce((sum, msg) => sum + (msg.content || '').length, 0);
  const inputTokens = estimateTokens(inputCharCount);

  // 9. Stream the tokens to client using SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let accumulatedResponse = '';

  try {
    const stream = AIService.streamAIResponse({
      task: 'general_chat',
      messages: apiMessages,
    });

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content || '';
      if (text) {
        accumulatedResponse += text;
        res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      }
    }

    // 10. Save conversation back to MongoDB session
    const userMsgObj = {
      role: 'user',
      content: message || '',
      attachments: attachmentData ? [attachmentData] : [],
      timestamp: new Date(),
    };

    const assistantMsgObj = {
      role: 'assistant',
      content: accumulatedResponse,
      timestamp: new Date(),
    };

    session.messages.push(userMsgObj);
    session.messages.push(assistantMsgObj);

    // Auto-rename session title on the first message
    if (session.title === 'New Chat' && message) {
      const cleanMsg = message.trim().replace(/\s+/g, ' ');
      session.title = cleanMsg.length > 30 ? cleanMsg.slice(0, 30) + '...' : cleanMsg;
    }

    await session.save();

    // Track token counts
    const outputTokens = estimateTokens(accumulatedResponse);
    const turnTokens = inputTokens + outputTokens;

    usage.tokensUsed += turnTokens;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    await usage.save();

    const remainingTokens = Math.max(0, 20000 - usage.tokensUsed);
    const isLocked = usage.tokensUsed >= 20000;

    // 11. Close SSE stream with lock indicators
    res.write(
      `data: ${JSON.stringify({
        done: true,
        title: session.title,
        tokensUsed: usage.tokensUsed,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        remainingTokens,
        isLocked,
      })}\n\n`
    );
    res.end();
  } catch (err) {
    console.error('[GENERAL CHAT] Streaming error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Error generating AI response.' })} \n\n`);
    res.end();
  }
});

/**
 * Rename the title of a specific general chat session.
 */
export const renameGeneralChatSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { title } = req.body;

  if (!title || title.trim().length === 0) {
    throw new AppError('Title is required', 400);
  }

  const session = await GeneralChatSession.findOneAndUpdate(
    { _id: id, userId },
    { title: title.trim() },
    { new: true }
  );

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  return res.status(200).json({
    status: 'success',
    session: {
      id: session._id,
      title: session.title,
      updatedAt: session.updatedAt,
    },
  });
});

/**
 * Delete a specific general chat session.
 */
export const deleteGeneralChatSession = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const session = await GeneralChatSession.findOneAndDelete({ _id: id, userId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  return res.status(200).json({
    status: 'success',
    message: 'Chat session deleted successfully.',
  });
});

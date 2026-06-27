import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import GeneralChatSession from '../models/GeneralChatSession.model.js';
import GeneralChatUsage from '../models/GeneralChatUsage.model.js';
import * as AIService from '../services/ai.service.js';
import * as ProfileService from '../services/profile.service.js';
import crypto from 'crypto';
import * as StorageService from '../services/storage.service.js';
import { parseAIJson } from '../utils/parseAIJson.js';

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
 * Send a message inside a specific chat session (performing session RAG over image memory).
 */
export const sendGeneralChatMessage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { message, imageHash } = req.body;

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

  let currentUploadedImage = null;

  // 6. Support fallback upload in this message request (same as background upload logic)
  if (req.file) {
    const isImage = req.file.mimetype.startsWith('image/');
    if (!isImage) {
      throw new AppError('Only image uploads are allowed in General Chat. PDFs can be studied in your Library.', 400);
    }
    if (req.file.size > 10 * 1024 * 1024) {
      throw new AppError('Image size too large. Vision model limit is 10MB.', 400);
    }

    const imageHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    // Check cache
    const existingSession = await GeneralChatSession.findOne({
      "imageKnowledge.imageHash": imageHash
    });

    if (existingSession) {
      const cachedRecord = existingSession.imageKnowledge.find(img => img.imageHash === imageHash);
      
      // Ensure cache is valid (has non-empty summary or extractedText)
      const isValidCache = cachedRecord && 
        ((cachedRecord.analysis?.summary && cachedRecord.analysis.summary.trim().length > 0) || 
         (cachedRecord.analysis?.extractedText && cachedRecord.analysis.extractedText.trim().length > 0));

      if (isValidCache) {
        currentUploadedImage = {
          imageHash: cachedRecord.imageHash,
          fileUrl: cachedRecord.fileUrl,
          fileKey: cachedRecord.fileKey,
          fileName: req.file.originalname || cachedRecord.fileName,
          analysis: cachedRecord.analysis,
          embeddings: cachedRecord.embeddings
        };
      } else {
        console.log(`[GENERAL CHAT] Cache entry found for hash ${imageHash} in sendGeneralChatMessage but analysis is empty/corrupt. Triggering cache miss / healing.`);
      }
    }

    if (!currentUploadedImage) {
      // Upload R2
      const sanitizedName = StorageService.sanitizeFilename(req.file.originalname || 'image.png');
      const fileKey = `general-chat/${userId}/${Date.now()}-${sanitizedName}`;
      const fileUrl = await StorageService.uploadToR2(req.file.buffer, fileKey, req.file.mimetype);

      // Vision API
      const base64 = req.file.buffer.toString('base64');
      const visionMessages = [
        {
          role: 'system',
          content: `You are an advanced academic vision intelligence model. Analyze the provided image thoroughly and output your analysis in raw JSON format matching this schema:
{
  "extractedText": "exact text from handwritten notes, slides, screenshots, or equations",
  "summary": "a clear 1-2 sentence summary of what the image shows",
  "questions": ["list of questions detected in the image, transcribed exactly"],
  "equations": ["list of math/science equations transcribed in LaTeX format"],
  "diagrams": ["descriptions of any graphs, charts, diagrams, or visual layouts"],
  "keyConcepts": ["list of key academic concepts mentioned or shown"],
  "detectedTopics": ["list of broad educational topics/subject areas"]
}
Do not wrap in markdown backticks or add any conversational filler. Return only valid raw JSON.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image and return the structured JSON analysis.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:${req.file.mimetype};base64,${base64}` },
            },
          ],
        }
      ];

      const visionResponseText = await AIService.generateAIResponse({ task: 'vision', messages: visionMessages });
      
      const defaultAnalysis = {
        extractedText: '',
        summary: '',
        questions: [],
        equations: [],
        diagrams: [],
        keyConcepts: [],
        detectedTopics: []
      };
      
      const parsedAnalysis = parseAIJson(visionResponseText, defaultAnalysis);

      if (!parsedAnalysis.extractedText?.trim() && !parsedAnalysis.summary?.trim()) {
        await StorageService.deleteFromR2(fileKey).catch(() => {});
        throw new AppError('Vision model returned an empty extraction. Please try another image.', 422);
      }

      // Embedding
      const searchText = `${parsedAnalysis.summary || ''} ${(parsedAnalysis.detectedTopics || []).join(' ')} ${(parsedAnalysis.keyConcepts || []).join(' ')} ${(parsedAnalysis.questions || []).join(' ')}`;
      const embeddings = await AIService.generateEmbedding(searchText);

      currentUploadedImage = {
        imageHash,
        fileUrl,
        fileKey,
        fileName: req.file.originalname || 'image.png',
        analysis: parsedAnalysis,
        embeddings
      };

      // Heal all records database-wide that have this imageHash
      await GeneralChatSession.updateMany(
        { "imageKnowledge.imageHash": imageHash },
        { 
          $set: { 
            "imageKnowledge.$[elem].analysis": currentUploadedImage.analysis,
            "imageKnowledge.$[elem].embeddings": currentUploadedImage.embeddings,
            "imageKnowledge.$[elem].fileUrl": currentUploadedImage.fileUrl,
            "imageKnowledge.$[elem].fileKey": currentUploadedImage.fileKey,
            "imageKnowledge.$[elem].fileName": currentUploadedImage.fileName,
          }
        },
        { 
          arrayFilters: [{ "elem.imageHash": imageHash }] 
        }
      );
    }

    // Attach to session
    const existingIdx = session.imageKnowledge.findIndex(img => img.imageHash === currentUploadedImage.imageHash);
    if (existingIdx === -1) {
      session.imageKnowledge.push(currentUploadedImage);
      await session.save();
    } else {
      // Keep in-memory session in sync and save to DB
      session.imageKnowledge[existingIdx] = currentUploadedImage;
      session.markModified('imageKnowledge');
      await session.save();
    }
  }

  // Helper function for Cosine Similarity
  const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  // Heal any corrupted/empty image records in this session before performing RAG
  if (session.imageKnowledge && session.imageKnowledge.length > 0) {
    let wasHealed = false;
    for (let i = 0; i < session.imageKnowledge.length; i++) {
      const img = session.imageKnowledge[i];
      const isValidCache = img.analysis && 
        ((img.analysis.summary && img.analysis.summary.trim().length > 0) || 
         (img.analysis.extractedText && img.analysis.extractedText.trim().length > 0));

      if (!isValidCache) {
        console.log(`[GENERAL CHAT RAG] Healing corrupted image record: ${img.fileName} (Hash: ${img.imageHash})`);
        try {
          // 1. Fetch the image buffer from R2 using its fileUrl
          const imageRes = await fetch(img.fileUrl);
          if (!imageRes.ok) {
            throw new Error(`Failed to fetch image from URL: ${img.fileUrl} (Status: ${imageRes.status})`);
          }
          const arrayBuffer = await imageRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Determine mimetype from URL or file extension
          let mimetype = 'image/png';
          if (img.fileUrl.endsWith('.jpg') || img.fileUrl.endsWith('.jpeg')) mimetype = 'image/jpeg';
          else if (img.fileUrl.endsWith('.webp')) mimetype = 'image/webp';

          // 2. Call Qwen Vision API for structured analysis
          const base64 = buffer.toString('base64');
          const visionMessages = [
            {
              role: 'system',
              content: `You are an advanced academic vision intelligence model. Analyze the provided image thoroughly and output your analysis in raw JSON format matching this schema:
{
  "extractedText": "exact text from handwritten notes, slides, screenshots, or equations",
  "summary": "a clear 1-2 sentence summary of what the image shows",
  "questions": ["list of questions detected in the image, transcribed exactly"],
  "equations": ["list of math/science equations transcribed in LaTeX format"],
  "diagrams": ["descriptions of any graphs, charts, diagrams, or visual layouts"],
  "keyConcepts": ["list of key academic concepts mentioned or shown"],
  "detectedTopics": ["list of broad educational topics/subject areas"]
}
Do not wrap in markdown backticks or add any conversational filler. Return only valid raw JSON.`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this image and return the structured JSON analysis.',
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimetype};base64,${base64}` },
                },
              ],
            }
          ];

          const visionResponseText = await AIService.generateAIResponse({ task: 'vision', messages: visionMessages });
          
          const defaultAnalysis = {
            extractedText: '',
            summary: '',
            questions: [],
            equations: [],
            diagrams: [],
            keyConcepts: [],
            detectedTopics: []
          };
          
          const parsedAnalysis = parseAIJson(visionResponseText, defaultAnalysis);

          if (!parsedAnalysis.extractedText?.trim() && !parsedAnalysis.summary?.trim()) {
            throw new Error('Vision model returned an empty extraction during healing.');
          }

          // 3. Generate RAG embeddings based on structured analysis texts
          const searchText = `${parsedAnalysis.summary || ''} ${(parsedAnalysis.detectedTopics || []).join(' ')} ${(parsedAnalysis.keyConcepts || []).join(' ')} ${(parsedAnalysis.questions || []).join(' ')}`;
          const embeddings = await AIService.generateEmbedding(searchText);

          // Update the session's imageKnowledge element
          img.analysis = parsedAnalysis;
          img.embeddings = embeddings;
          wasHealed = true;

          // 4. Update database-wide to heal all other session documents as well
          await GeneralChatSession.updateMany(
            { "imageKnowledge.imageHash": img.imageHash },
            { 
              $set: { 
                "imageKnowledge.$[elem].analysis": parsedAnalysis,
                "imageKnowledge.$[elem].embeddings": embeddings
              }
            },
            { 
              arrayFilters: [{ "elem.imageHash": img.imageHash }] 
            }
          );
          
          console.log(`[GENERAL CHAT RAG] Successfully healed image record database-wide: ${img.fileName}`);
        } catch (healErr) {
          console.error(`[GENERAL CHAT RAG] Failed to heal image ${img.fileName}:`, healErr.message);
        }
      }
    }

    if (wasHealed) {
      session.markModified('imageKnowledge');
      await session.save();
    }
  }

  // 7. Session RAG: Identify active vs historical session images and retrieve their context
  let retrievedContext = '';
  const searchString = message || '';

  if (session.imageKnowledge && session.imageKnowledge.length > 0) {
    try {
      // Find which image is the ACTIVE one in this request
      let activeImage = null;

      // 7.1. Check if a new file was uploaded in this turn
      if (currentUploadedImage) {
        activeImage = currentUploadedImage;
      }
      // 7.2. Check if the frontend explicitly passed an imageHash
      else if (imageHash) {
        activeImage = session.imageKnowledge.find(img => img.imageHash === imageHash);
      }

      // 7.3. If not explicitly defined, run similarity search or default to the most recent one
      if (!activeImage && searchString.trim().length > 0) {
        const queryEmbedding = await AIService.generateEmbedding(searchString);
        const matches = session.imageKnowledge.map(img => {
          const score = cosineSimilarity(queryEmbedding, img.embeddings);
          return { img, score };
        });

        // Sort descending by similarity score
        matches.sort((a, b) => b.score - a.score);

        // If highest match is above a threshold, set as active
        if (matches[0] && matches[0].score > 0.25) {
          activeImage = matches[0].img;
        } else {
          // Default to the most recently uploaded image in the session
          activeImage = session.imageKnowledge[session.imageKnowledge.length - 1];
        }
      } else if (!activeImage) {
        // Default to the most recently uploaded image
        activeImage = session.imageKnowledge[session.imageKnowledge.length - 1];
      }

      console.log(`[GENERAL CHAT RAG] Active image identified: ${activeImage ? activeImage.fileName : 'None'}`);

      // 7.4. Build structured context containing the active image and all other historical images
      const contextParts = [];

      // Include Active Image with full OCR details
      if (activeImage) {
        const analysis = activeImage.analysis;
        contextParts.push(
          `[ACTIVE IMAGE CURRENTLY BEING ASKED ABOUT: "${activeImage.fileName}"]\n` +
          `- Summary: ${analysis.summary || 'None'}\n` +
          `- Topics: ${(analysis.detectedTopics || []).join(', ')}\n` +
          `- Key Concepts: ${(analysis.keyConcepts || []).join(', ')}\n` +
          `- Detected Questions:\n${(analysis.questions || []).map((q, i) => `  * Question ${i+1}: ${q}`).join('\n')}\n` +
          `- Equations (LaTeX):\n${(analysis.equations || []).map(eq => `  * ${eq}`).join('\n')}\n` +
          `- Diagram Descriptions:\n${(analysis.diagrams || []).map(diag => `  * ${diag}`).join('\n')}\n` +
          `- Full Extracted OCR Text:\n"""\n${analysis.extractedText || ''}\n"""`
        );
      }

      // Include other historical images with truncated OCR details (to prevent context bloat but allow focus-shifting)
      // Limit to the top 2 most relevant or recent historical images to prevent token bloat
      let historicalImages = session.imageKnowledge.filter(img => !activeImage || img.imageHash !== activeImage.imageHash);
      if (historicalImages.length > 2) {
        if (searchString.trim().length > 0) {
          const queryEmbedding = await AIService.generateEmbedding(searchString);
          historicalImages = historicalImages.map(img => ({
            img,
            score: cosineSimilarity(queryEmbedding, img.embeddings)
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
          .map(item => item.img);
        } else {
          historicalImages = historicalImages.slice(-2);
        }
      }

      if (historicalImages.length > 0) {
        const historyContext = historicalImages.map((img, index) => {
          const analysis = img.analysis;
          const truncatedOcr = (analysis.extractedText || '').slice(0, 800);
          return `[HISTORICAL IMAGE #${index + 1} IN SESSION: "${img.fileName}"]\n` +
            `- Summary: ${analysis.summary || 'None'}\n` +
            `- Topics: ${(analysis.detectedTopics || []).join(', ')}\n` +
            `- Key Concepts: ${(analysis.keyConcepts || []).join(', ')}\n` +
            `- Brief OCR Text (truncated):\n"""\n${truncatedOcr}${analysis.extractedText && analysis.extractedText.length > 800 ? '... [truncated]' : ''}\n"""`;
        }).join('\n\n');
        
        contextParts.push(
          `[PAST IMAGES IN THIS CHAT HISTORY (FOR REFERENCE / FOCUS SHIFTING)]:\n${historyContext}`
        );
      }

      retrievedContext = contextParts.join('\n\n========================================\n\n');

    } catch (ragErr) {
      console.error('[GENERAL CHAT RAG] Context generation failed:', ragErr.message);
    }
  }

  // 8. Inject retrieved RAG context into full message
  let fullUserContent = message || '';
  if (retrievedContext) {
    fullUserContent = `${retrievedContext}\n\n[USER QUERY]:\n${fullUserContent}`;
  }

  // 9. Map last 10 messages for short-term chat context
  const recentHistory = session.messages.slice(-10).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Fetch the student's profile context to personalize the tutor instructions
  const profile = await ProfileService.getProfile(userId);
  const studentName = req.user.name || 'Student';
  const studyLevel = profile?.studyLevel || '';
  const goal = profile?.goal || '';
  const level = profile?.level || 'beginner';
  const weakTopics = profile?.weakTopics?.length > 0 ? profile.weakTopics.slice(0, 5).join(', ') : '';
  const strongTopics = profile?.strongTopics?.length > 0 ? profile.strongTopics.slice(0, 5).join(', ') : '';

  // Build a compact, effective system prompt
  let profileContext = `Student: ${studentName}`;
  if (studyLevel) profileContext += ` | Level: ${studyLevel}`;
  if (goal) profileContext += ` | Goal: ${goal}`;
  if (level) profileContext += ` | Track: ${level}`;
  if (weakTopics) profileContext += `\nNeeds help with: ${weakTopics}`;
  if (strongTopics) profileContext += `\nStrong in: ${strongTopics}`;

  const systemInstructions = 
    `You are Braudle AI.\n` +
    `You are a helpful, intelligent assistant.\n` +
    `Your goal is to help users quickly, clearly, and accurately.\n\n` +
    `${profileContext}\n\n` +
    `PERSONALITY:\n` +
    `- Be friendly, smart, practical, clear, and fast.\n` +
    `- Avoid overly formal language, long introductions, and unnecessary explanations.\n` +
    `- Address ${studentName} by name naturally (not every message).\n\n` +
    `RESPONSE STYLE:\n` +
    `- Answer directly first. Then explain if needed.\n` +
    `- Do not make users work hard to get simple answers.\n\n` +
    `LENGTH CONTROL:\n` +
    `- Default to concise responses (simple answers ≤150 words, explanations ≤300 words).\n` +
    `- Expand only when the user asks for details, the task requires depth, or the user requests step-by-step help.\n\n` +
    `IMAGE UNDERSTANDING & FOCUS SHIFTING & GROUNDING:\n` +
    `- You are BRAUDLE, an intelligent study assistant. You help students understand their study material by answering questions based on content they have uploaded.\n` +
    `- You have been given extracted content from one or more images the student uploaded. This is your ONLY source of truth for answering. Do not answer from general knowledge unless the retrieved content is genuinely insufficient and you clearly say so.\n` +
    `- WHEN ANSWERING:\n` +
    `  * Answer directly and clearly based on the retrieved image content.\n` +
    `  * Always reference where your answer is coming from — e.g. "Based on your diagram..." or "From your notes on [topic]..." or "Your uploaded image shows that..."\n` +
    `  * If the answer is spread across multiple images, reference each one clearly — "From Image 1 (the diagram)... and from Image 2 (your notes)..."\n` +
    `  * Break down complex concepts into simple language — you are a study assistant, not a textbook.\n` +
    `  * If a formula, definition, or list was in the image, reproduce it exactly as extracted.\n` +
    `  * If the image had a diagram, explain it step by step using the description.\n` +
    `- WHEN CONTENT IS NOT ENOUGH:\n` +
    `  * If the retrieved content partially answers the question, answer what you can and clearly say "Your uploaded material does not cover [specific part] — you may want to check your textbook for that".\n` +
    `  * Never hallucinate or fill gaps with invented information. Never pretend the image said something it did not.\n` +
    `- WHEN THE STUDENT IS CONFUSED:\n` +
    `  * If the question suggests the student misunderstood something in their material, gently correct it and explain using what the image actually shows.\n` +
    `  * Use analogies and simple examples to reinforce concepts from the image.\n` +
    `- RESPONSE FORMAT:\n` +
    `  * Keep responses focused and not unnecessarily long.\n` +
    `  * Use bullet points or numbered steps when explaining processes or lists from the image.\n` +
    `  * Bold key terms when you first use them.\n` +
    `  * End with a follow-up prompt when appropriate — e.g. "Would you like me to break down any part of this further?" or "Do you want me to quiz you on this?"\n` +
    `- An image is labeled as [ACTIVE IMAGE CURRENTLY BEING ASKED ABOUT] if the user just uploaded it or is currently referring to it. Shift your focus primarily to this active image for the current turn.\n` +
    `- Other images are labeled as [HISTORICAL IMAGE IN SESSION] and represent past context. If the user asks to "go back to the first image", "compare them", or refers to their filenames/content, dynamically shift your focus back to the relevant historical image using its historical context.\n` +
    `- Never ignore uploaded images. Do not repeat OCR text back.\n\n` +
    `FOLLOW-UP QUESTIONS:\n` +
    `- Remember information from the current conversation. Use relevant session context when available. Do not ask the user to repeat information already provided.\n\n` +
    `PROBLEM SOLVING:\n` +
    `When solving problems:\n` +
    `1. Understand the problem\n` +
    `2. Explain reasoning\n` +
    `3. Give the answer\n` +
    `4. Keep explanations practical\n\n` +
    `STUDENT-FRIENDLY:\n` +
    `If the user appears to be learning:\n` +
    `- Simplify difficult ideas\n` +
    `- Use examples\n` +
    `- Avoid unnecessary jargon\n` +
    `Do not automatically become a tutor. Only teach deeply when requested.\n\n` +
    `CODE:\n` +
    `When writing code:\n` +
    `- Explain briefly\n` +
    `- Give clean code\n` +
    `- Avoid unnecessary complexity\n\n` +
    `ACCURACY:\n` +
    `- If uncertain, state uncertainty clearly. Do not invent facts.\n\n` +
    `MATH FORMATTING (CRITICAL):\n` +
    `- Use LaTeX: display math $$ ... $$ for key formulas, inline $ ... $ for variables\n` +
    `- Use \\\\frac{}{}, \\\\sqrt{}, \\\\int, \\\\sum, x^2 etc. Never use ASCII math or Unicode symbols\n` +
    `- Separate multi-step solutions onto individual lines\n\n` +
    `FORMATTING:\n` +
    `- Use ## headings for sections, **bold** for key terms, bullet lists for steps\n` +
    `- Keep it scannable. The user should feel "That was helpful and easy to understand" rather than "I just read a textbook."`;

  const apiMessages = [
    { role: 'system', content: systemInstructions },
    ...recentHistory,
    { role: 'user', content: fullUserContent },
  ];

  // Calculate pre-chat input tokens
  const inputCharCount = apiMessages.reduce((sum, msg) => sum + (msg.content || '').length, 0);
  const inputTokens = estimateTokens(inputCharCount);

  // 10. Stream the tokens to client using SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let accumulatedResponse = '';

  try {
    const stream = AIService.streamAIResponse({
      task: 'general_chat',
      messages: apiMessages,
      max_tokens: 2048,
    });

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content || '';
      if (text) {
        accumulatedResponse += text;
        res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      }
    }

    // Save attachment details for UI display compatibility if a file was uploaded or referenced in this request
    let attachmentData = null;
    const activeImageRef = currentUploadedImage || (imageHash ? session.imageKnowledge.find(img => img.imageHash === imageHash) : null);
    if (activeImageRef) {
      attachmentData = {
        name: activeImageRef.fileName,
        fileType: 'image',
        extractedText: activeImageRef.analysis.extractedText
      };
    }

    // 11. Save conversation back to MongoDB session
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

    // 12. Close SSE stream with lock indicators
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

/**
 * Upload and analyze an image immediately.
 * Uses SHA-256 buffer hashing to cache and reuse existing structured vision analyses, saving model costs.
 */
export const uploadGeneralChatImage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id: sessionId } = req.params;
  const file = req.file;

  if (!file) {
    throw new AppError('No file uploaded', 400);
  }

  const isImage = file.mimetype.startsWith('image/');
  if (!isImage) {
    throw new AppError('Only image uploads are allowed in General Chat. PDFs can be studied in your Library.', 400);
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new AppError('Image size too large. Vision model limit is 10MB.', 400);
  }

  // 1. Verify session belongs to user
  const session = await GeneralChatSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError('Session not found', 404);
  }

  // 2. Generate SHA-256 hash of the image buffer
  const imageHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  // 3. Check cache: Look up if this image was already analyzed in any session by this user (or globally)
  const existingSession = await GeneralChatSession.findOne({
    "imageKnowledge.imageHash": imageHash
  });

  let imageRecord = null;

  if (existingSession) {
    const cachedRecord = existingSession.imageKnowledge.find(img => img.imageHash === imageHash);
    
    // Ensure cache is valid (has non-empty summary or extractedText)
    const isValidCache = cachedRecord && 
      ((cachedRecord.analysis?.summary && cachedRecord.analysis.summary.trim().length > 0) || 
       (cachedRecord.analysis?.extractedText && cachedRecord.analysis.extractedText.trim().length > 0));

    if (isValidCache) {
      console.log(`[GENERAL CHAT] Cache hit for image hash: ${imageHash}. Reusing analysis.`);
      imageRecord = {
        imageHash: cachedRecord.imageHash,
        fileUrl: cachedRecord.fileUrl,
        fileKey: cachedRecord.fileKey,
        fileName: file.originalname || cachedRecord.fileName,
        analysis: cachedRecord.analysis,
        embeddings: cachedRecord.embeddings
      };
    } else {
      console.log(`[GENERAL CHAT] Cache entry found for hash ${imageHash} but analysis is empty/corrupt. Triggering cache miss / healing.`);
    }
  }

  // 4. Cache Miss: Upload to R2, call Vision API, generate embeddings
  if (!imageRecord) {
    console.log(`[GENERAL CHAT] Cache miss for image hash: ${imageHash}. Processing via Vision model.`);
    
    // Upload to R2
    const sanitizedName = StorageService.sanitizeFilename(file.originalname || 'image.png');
    const fileKey = `general-chat/${userId}/${Date.now()}-${sanitizedName}`;
    const fileUrl = await StorageService.uploadToR2(file.buffer, fileKey, file.mimetype);

    // Call Llama 3.2 Vision for structured analysis
    const base64 = file.buffer.toString('base64');
    const visionMessages = [
      {
        role: 'system',
        content: `You are an advanced academic vision intelligence model. Analyze the provided image thoroughly and output your analysis in raw JSON format matching this schema:
{
  "extractedText": "exact text from handwritten notes, slides, screenshots, or equations",
  "summary": "a clear 1-2 sentence summary of what the image shows",
  "questions": ["list of questions detected in the image, transcribed exactly"],
  "equations": ["list of math/science equations transcribed in LaTeX format"],
  "diagrams": ["descriptions of any graphs, charts, diagrams, or visual layouts"],
  "keyConcepts": ["list of key academic concepts mentioned or shown"],
  "detectedTopics": ["list of broad educational topics/subject areas"]
}
Do not wrap in markdown backticks or add any conversational filler. Return only valid raw JSON.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze this image and return the structured JSON analysis.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${file.mimetype};base64,${base64}` },
          },
        ],
      }
    ];

    let visionResponseText;
    try {
      visionResponseText = await AIService.generateAIResponse({ task: 'vision', messages: visionMessages });
    } catch (err) {
      console.error('[GENERAL CHAT] Vision analysis failed:', err.message);
      // Clean up R2 upload on failure
      await StorageService.deleteFromR2(fileKey).catch(() => {});
      throw new AppError(`Vision model failed to analyze image: ${err.message}`, 500);
    }

    const defaultAnalysis = {
      extractedText: '',
      summary: '',
      questions: [],
      equations: [],
      diagrams: [],
      keyConcepts: [],
      detectedTopics: []
    };

    const parsedAnalysis = parseAIJson(visionResponseText, defaultAnalysis);

    if (!parsedAnalysis.extractedText?.trim() && !parsedAnalysis.summary?.trim()) {
      await StorageService.deleteFromR2(fileKey).catch(() => {});
      throw new AppError('Vision model returned an empty extraction. Please try another image.', 422);
    }

    // Generate RAG embeddings based on structured analysis texts
    const searchText = `${parsedAnalysis.summary || ''} ${(parsedAnalysis.detectedTopics || []).join(' ')} ${(parsedAnalysis.keyConcepts || []).join(' ')} ${(parsedAnalysis.questions || []).join(' ')}`;
    const embeddings = await AIService.generateEmbedding(searchText);

    imageRecord = {
      imageHash,
      fileUrl,
      fileKey,
      fileName: file.originalname || 'image.png',
      analysis: parsedAnalysis,
      embeddings
    };

    // Heal all records database-wide that have this imageHash
    await GeneralChatSession.updateMany(
      { "imageKnowledge.imageHash": imageHash },
      { 
        $set: { 
          "imageKnowledge.$[elem].analysis": imageRecord.analysis,
          "imageKnowledge.$[elem].embeddings": imageRecord.embeddings,
          "imageKnowledge.$[elem].fileUrl": imageRecord.fileUrl,
          "imageKnowledge.$[elem].fileKey": imageRecord.fileKey,
          "imageKnowledge.$[elem].fileName": imageRecord.fileName,
        }
      },
      { 
        arrayFilters: [{ "elem.imageHash": imageHash }] 
      }
    );
  }

  // 5. Store image knowledge inside current session if not already attached
  const existingIdx = session.imageKnowledge.findIndex(img => img.imageHash === imageHash);
  if (existingIdx === -1) {
    session.imageKnowledge.push(imageRecord);
    await session.save();
  } else {
    // Keep in-memory session in sync and save to DB
    session.imageKnowledge[existingIdx] = imageRecord;
    session.markModified('imageKnowledge');
    await session.save();
  }

  return res.status(200).json({
    status: 'success',
    message: 'Image analyzed and stored in session memory successfully.',
    fileName: imageRecord.fileName,
    fileUrl: imageRecord.fileUrl,
    imageHash: imageRecord.imageHash,
    analysis: imageRecord.analysis
  });
});

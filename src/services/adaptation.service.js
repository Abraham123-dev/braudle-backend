import Conversation from '../models/Conversation.model.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import StudentProfile from '../models/StudentProfile.model.js';
import * as AIService from './ai.service.js';
import { buildSessionAnalysisPrompt } from '../utils/promptBuilder.js';
import { GROQ_MODELS } from '../config/models.js';

/**
 * Extracts misconceptions and a summary from a completed session's chat transcript.
 * Updates the associated Document and the global StudentProfile.
 * @param {string} sessionId 
 */
export const extractSessionInsights = async (sessionId) => {
  try {
    const session = await Session.findById(sessionId);
    if (!session) return;

    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation || !conversation.messages || conversation.messages.length < 3) {
      // Not enough data to extract meaningful insights
      return;
    }

    // Use the smart model to analyze the transcript
    const prompt = buildSessionAnalysisPrompt(conversation.messages);
    const response = await AIService.callGroqWithRetry([{ role: 'user', content: prompt }], GROQ_MODELS.smart);

    // Clean and parse JSON
    const cleanJson = response.replace(/```json|```/g, '').trim();
    const insights = JSON.parse(cleanJson);

    // 1. Update Session with Summary
    if (insights.summary) {
      session.summary = insights.summary;
      await session.save();
    }

    // 2. Update Document with Misconceptions
    if (insights.misconceptions && insights.misconceptions.length > 0) {
      await Document.findByIdAndUpdate(
        session.documentId,
        { $push: { misconceptions: { $each: insights.misconceptions } } }
      );

      // 3. Update StudentProfile with Weak Topics globally
      const newTopics = insights.misconceptions.map(m => m.topic);
      await StudentProfile.findOneAndUpdate(
        { userId: session.userId },
        { $addToSet: { weakTopics: { $each: newTopics } } }
      );
    }
  } catch (error) {
    console.error(`[AdaptationService] Failed to extract insights for session ${sessionId}:`, error.message);
    // Silent fail in background so it doesn't crash the server
  }
};

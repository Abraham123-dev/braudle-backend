import Conversation from '../models/Conversation.model.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import * as AIService from './ai.service.js';
import * as ProfileService from './profile.service.js';

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
      return;
    }

    const document = await Document.findById(session.documentId).select('topics');
    const documentTopics = document?.topics || [];

    const { weakTopics, strongTopics, misconceptions, summary } = await AIService.analyzeSession(
      conversation.messages,
      documentTopics
    );

    if (summary) {
      session.summary = summary;
      await session.save();
    }

    const validMisconceptions = Array.isArray(misconceptions) ? misconceptions : [];
    if (validMisconceptions.length > 0) {
      await Document.findByIdAndUpdate(session.documentId, {
        $push: { 
          misconceptions: { 
            $each: validMisconceptions.map(m => ({ topic: m.topic, description: m.description })) 
          } 
        }
      });
    }

    await ProfileService.updateProfileAfterSessionAnalysis(session.userId, {
      weakTopics,
      strongTopics,
      misconceptions,
      sessionId: session._id
    });
  } catch (error) {
    console.error(`[AdaptationService] Failed to extract insights for session ${sessionId}:`, error.message);
    // Silent fail in background so it doesn't crash the server
  }
};

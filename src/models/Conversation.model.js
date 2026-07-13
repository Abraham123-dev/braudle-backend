import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    messages: [
      new mongoose.Schema({
        role: {
          type: String,
          enum: ['user', 'assistant', 'system'],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      }, { _id: false })
    ],
    summaryMemory: {
      type: String,
      default: '',
    },
    lastChatResetDate: {
      type: Date,
      default: Date.now,
    },
    lastExplainResetDate: {
      type: Date,
      default: Date.now,
    },
    chatMessagesCount: {
      type: Number,
      default: 0,
    },
    explainMessagesCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Conversation', conversationSchema);
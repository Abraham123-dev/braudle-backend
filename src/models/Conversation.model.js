import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    type: { type: String, enum: ['explanation', 'question', 'answer', 'feedback'] },
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

// Indexes for efficient lookups by session and user
conversationSchema.index({ sessionId: 1 });
conversationSchema.index({ userId: 1 });
// Common access pattern: find conversation by session and user
conversationSchema.index({ sessionId: 1, userId: 1 });

export default mongoose.model('Conversation', conversationSchema);

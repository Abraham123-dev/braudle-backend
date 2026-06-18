import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ['understand', 'review', 'practice', 'prepare', 'ask', 'flashcards'],
      default: 'understand',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'abandoned'],
      default: 'active',
    },
    currentChunkIndex: {
      type: Number,
      default: 0,
    },
    score: {
      type: Number,
      default: 0,
    },
    summary: {
      type: String,
    },
    mentorSuggestions: {
      type: [String],
      default: [],
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    durationMinutes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Session', sessionSchema);
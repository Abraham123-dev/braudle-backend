import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const weeklyChallengeSchema = new Schema(
  {
    description: { type: String },
    target: { type: Number },
    progress: { type: Number, default: 0, min: 0 },
    completed: { type: Boolean, default: false },
    xpReward: { type: Number },
  },
  { _id: false }
);

const learningHistoryItemSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'Document' },
    topic: { type: String },
    score: { type: Number, min: 0, max: 100 },
    mode: { type: String },
    date: { type: Date },
  },
  { _id: false }
);

const studentProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
    studyLevel: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Study level is too long'],
    },
    learningStyle: {
      type: String,
      trim: true,
      default: 'explain_first',
      maxlength: 256,
      message: 'Learning style is too long',
    },
    goal: {
      type: String,
      trim: true,
      default: 'pass_exams',
      maxlength: 256,
      message: 'Goal is too long',
    },
    weakTopics: { type: [String], default: [] },
    strongTopics: { type: [String], default: [] },
    // Tracks last 5 quiz scores for adaptive level-up calculation.
    // Must be persisted so level upgrades survive server restarts.
    recentScores: { type: [Number], default: [] },
    misconceptionHistory: [
      {
        topic: { type: String, required: true },
        description: { type: String, required: true },
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
        occurredAt: { type: Date, default: Date.now }
      }
    ],
    xp: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'xp must be an integer' } },
    streak: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'streak must be an integer' } },
    longestStreak: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'longestStreak must be an integer' } },
    lastStudyDate: { type: Date },
    totalSessions: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'totalSessions must be an integer' } },
    averageScore: { type: Number, default: 0, min: 0, max: 100 },
    weeklyChallenge: { type: weeklyChallengeSchema, default: () => ({}) },
    learningHistory: { type: [learningHistoryItemSchema], default: [] },
    /**
     * Flashcards generated during study sessions.
     * Auto-saved when generated in flashcard mode.
     * Organized by documentId + topic so the frontend can render a proper flashcard library.
     */
    savedFlashcards: {
      type: [
        {
          documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
          documentTitle: { type: String, required: true },
          topic: { type: String, required: true, trim: true },
          front: { type: String, required: true, trim: true },
          back: { type: String, required: true, trim: true },
          savedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model('StudentProfile', studentProfileSchema);

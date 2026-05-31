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
    subjects: { type: [String], default: [] },
    learningStyle: { type: String, enum: ['explain_first', 'test_first', 'mix'], default: 'explain_first' },
    goal: { type: String, enum: ['pass_exams', 'scholarship', 'understand', 'stay_ahead'], default: 'pass_exams' },
    weakTopics: { type: [String], default: [] },
    strongTopics: { type: [String], default: [] },
    xp: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'xp must be an integer' } },
    streak: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'streak must be an integer' } },
    longestStreak: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'longestStreak must be an integer' } },
    lastStudyDate: { type: Date },
    totalSessions: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'totalSessions must be an integer' } },
    averageScore: { type: Number, default: 0, min: 0, max: 100 },
    weeklyChallenge: { type: weeklyChallengeSchema, default: () => ({}) },
    learningHistory: { type: [learningHistoryItemSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('StudentProfile', studentProfileSchema);

import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    mode: { type: String, enum: ['teach', 'quiz', 'breakdown', 'exam'], required: true },
    status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
    currentChunkIndex: { type: Number, default: 0 },
    explainLevel: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
    score: { type: Number },
    summary: { type: String },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    durationMinutes: { type: Number },
  },
  { timestamps: true }
);

// Indexes to support common lookups
sessionSchema.index({ userId: 1 });
sessionSchema.index({ documentId: 1 });
sessionSchema.index({ status: 1 });

export default mongoose.model('Session', sessionSchema);

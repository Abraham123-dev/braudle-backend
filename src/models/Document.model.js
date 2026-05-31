import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['pdf', 'image'], required: true },
    fileUrl: { type: String, required: true },
    fileKey: { type: String, required: true },
    rawText: { type: String },
    chunks: { type: [String], default: [] },
    totalChunks: { type: Number, default: 0 },
    subject: { type: String, trim: true },
    processingStatus: { type: String, enum: ['pending', 'processing', 'ready', 'failed'], default: 'pending' },
  },
  { timestamps: true }
);

// Indexes to speed up common queries
documentSchema.index({ userId: 1 });
documentSchema.index({ processingStatus: 1 });
// Compound index for fetching a user's documents by status
documentSchema.index({ userId: 1, processingStatus: 1 });

export default mongoose.model('Document', documentSchema);

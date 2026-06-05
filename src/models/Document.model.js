import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['pdf', 'image'],
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    fileKey: {
      type: String,
      required: true,
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
      default: 'pending',
    },
    rawText: {
      type: String,
    },
    chunks: {
      type: [String],
      default: [],
    },
    totalChunks: {
      type: Number,
      default: 0,
    },
    misconceptions: [
      {
        topic: { type: String, required: true },
        description: { type: String, required: true },
        identifiedAt: { type: Date, default: Date.now },
        isResolved: { type: Boolean, default: false }
      }
    ]
  },
  { timestamps: true }
);

// Indexes to speed up common queries
documentSchema.index({ processingStatus: 1 });
// Compound index for fetching a user's documents by status
documentSchema.index({ userId: 1, processingStatus: 1 });

export default mongoose.model('Document', documentSchema);

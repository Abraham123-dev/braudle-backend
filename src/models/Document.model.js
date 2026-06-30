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
    // Granular 6-stage progress for the frontend progress bar
    processingStage: {
      type: String,
      enum: [
        'file_received',
        'extracting_content',
        'identifying_concepts',
        'building_learning_map',
        'preparing_tutor',
        'ready',
        'failed',
      ],
      default: 'file_received',
    },
    rawText: {
      type: String,
    },
    chunks: {
      type: [String],
      default: [],
    },
    chunkEmbeddings: {
      type: [[Number]],
      default: [],
    },
    totalChunks: {
      type: Number,
      default: 0,
    },
    // AI-extracted learning intelligence
    topics: {
      type: [String],
      default: [],
    },
    summary: {
      type: String,
      default: '',
    },
    detailedSummary: {
      type: String,
      default: '',
    },
    misconceptions: [
      {
        topic: { type: String, required: true },
        description: { type: String, required: true },
        identifiedAt: { type: Date, default: Date.now },
        isResolved: { type: Boolean, default: false }
      }
    ],
    // Set to true by the worker if Groq fails to extract topics/summary.
    // The document is still fully usable for teaching — chunks are intact.
    // Frontend can use this to skip rendering the summary card gracefully.
    aiUnderstandingFailed: {
      type: Boolean,
      default: false,
    },
    knowledgeCache: {
      concepts: [{
        name: { type: String },
        explanation: { type: String }
      }],
      definitions: [{
        term: { type: String },
        definition: { type: String }
      }],
      learningObjectives: [String],
      keyFacts: [String],
      importantExamples: [{
        topic: { type: String },
        description: { type: String }
      }],
      formulae: [{
        name: { type: String },
        formula: { type: String },
        explanation: { type: String }
      }],
      flashcards: [{
        front: { type: String },
        back: { type: String },
        concept: { type: String }
      }],
      questionBank: [{
        question: { type: String },
        type: { type: String },
        options: [String],
        answer: { type: String },
        explanation: { type: String },
        difficulty: { type: String },
        topic: { type: String }
      }],
      examTopics: [String]
    },
    sessionMemory: {
      flashcardsShown: { type: [String], default: [] },
      questionsServed: { type: [String], default: [] },
      practiceGuidesGenerated: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes to speed up common queries
documentSchema.index({ processingStatus: 1 });
// Compound index for fetching a user's documents by status
documentSchema.index({ userId: 1, processingStatus: 1 });

export default mongoose.model('Document', documentSchema);

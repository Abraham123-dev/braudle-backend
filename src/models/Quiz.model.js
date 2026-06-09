import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  question: { type: String, required: true },
  type: { type: String, enum: ['mcq', 'true_false', 'theory'], required: true },
  options: [String], // Only used for MCQ
  answer: { type: String, required: true },
  explanation: { type: String },
  studentAnswer: { type: String, default: '' },
  isCorrect: { type: Boolean, default: false }
});

const quizSchema = new mongoose.Schema(
  {
    sessionId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Session', 
      required: true 
    },
    documentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Document', 
      required: true 
    },
    questions: [questionSchema],
    totalQuestions: { type: Number, required: true },
    score: { type: Number },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

// Ensure we can quickly find quizzes by session or document
quizSchema.index({ sessionId: 1 });
quizSchema.index({ documentId: 1 });

export default mongoose.model('Quiz', quizSchema);
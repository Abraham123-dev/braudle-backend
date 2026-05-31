import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const questionSchema = new Schema(
  {
    question: { type: String, required: true },
    type: { type: String, enum: ['mcq', 'theory', 'true_false'], required: true },
    options: { type: [String] },
    answer: { type: String, required: true },
    explanation: { type: String, required: true },
    studentAnswer: { type: String },
    isCorrect: { type: Boolean },
  },
  { _id: false }
);

const quizSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    questions: { type: [questionSchema], default: [] },
    totalQuestions: { type: Number, required: true },
    score: { type: Number },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

// Ensure MCQ questions include at least two options
quizSchema.pre('save', function (next) {
  if (!this.questions || !Array.isArray(this.questions)) return next();
  for (const q of this.questions) {
    if (q.type === 'mcq') {
      if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
        return next(new Error('MCQ questions must include at least two options'));
      }
    }
  }
  next();
});

// Indexes for efficient queries
quizSchema.index({ sessionId: 1 });
quizSchema.index({ documentId: 1 });

export default mongoose.model('Quiz', quizSchema);

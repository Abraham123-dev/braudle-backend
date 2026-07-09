import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, unique: true, sparse: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    avatar: { type: String },
    authProvider: { type: String, enum: ['google', 'email'], default: 'google' },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    uploadCount: {
      pdf: { type: Number, default: 0 },
      image: { type: Number, default: 0 },
    },
    lastUploadDate: { type: Date },
    onboardingComplete: { type: Boolean, default: false },
    plan: {
      type: String,
      enum: ['free', 'plus', 'pro'],
      default: 'free',
    },
    dailyTokenUsage: {
      type: Number,
      default: 0,
    },
    lastTokenResetDate: {
      type: Date,
      default: Date.now,
    },
    dailyGenerationsCount: {
      flashcards: { type: Number, default: 0 },
      practice: { type: Number, default: 0 },
      exam: { type: Number, default: 0 },
    },
    lastGenerationResetDate: {
      type: Date,
      default: Date.now,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export default mongoose.model('User', userSchema);

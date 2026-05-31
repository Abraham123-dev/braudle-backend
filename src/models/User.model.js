import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    avatar: { type: String },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    uploadCount: {
      pdf: { type: Number, default: 0 },
      image: { type: Number, default: 0 },
    },
    lastUploadDate: { type: Date },
    onboardingComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);

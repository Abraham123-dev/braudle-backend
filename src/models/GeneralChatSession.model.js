import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String },
  fileType: { type: String, enum: ['image'], required: true },
  extractedText: { type: String },
}, { _id: false });

const generalChatMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  attachments: [attachmentSchema],
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const generalChatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: 'New Chat',
    },
    messages: [generalChatMessageSchema],
  },
  { timestamps: true }
);

export default mongoose.model('GeneralChatSession', generalChatSessionSchema);

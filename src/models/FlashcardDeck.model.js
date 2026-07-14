import mongoose from 'mongoose';

const flashcardSchema = new mongoose.Schema({
  topic: { type: String, default: 'General' },
  front: { type: String, required: true },
  back: { type: String, required: true },
});

const flashcardDeckSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    conceptName: { type: String, default: 'General' },
    cards: [flashcardSchema],
    cardCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Quickly fetch all decks for a user, or all decks for a document
flashcardDeckSchema.index({ userId: 1, createdAt: -1 });
flashcardDeckSchema.index({ documentId: 1 });

export default mongoose.model('FlashcardDeck', flashcardDeckSchema);

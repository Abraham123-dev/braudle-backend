import { mongoose } from '../config/db.js';

const { Schema } = mongoose;

const masteryConceptSchema = new Schema(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true, 
      index: true 
    },
    documentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Document', 
      required: true, 
      index: true 
    },
    conceptName: { 
      type: String, 
      required: true, 
      trim: true 
    },
    // SM-2 Spaced Repetition Parameters
    box: { 
      type: Number, 
      default: 1, 
      min: 1, 
      max: 5 
    },
    repetitions: { 
      type: Number, 
      default: 0,
      min: 0
    },
    interval: { 
      type: Number, 
      default: 1, 
      min: 1 
    }, // interval in days before next review
    easeFactor: { 
      type: Number, 
      default: 2.5, 
      min: 1.3 
    }, // easiness factor (EF), default is 2.5, min is 1.3
    nextReviewDate: { 
      type: Date, 
      default: Date.now, 
      index: true 
    },
    // Overall mastery evaluation (0-100%)
    masteryScore: { 
      type: Number, 
      default: 0, 
      min: 0, 
      max: 100 
    },
    // Performance Review logs
    history: [
      {
        reviewedAt: { 
          type: Date, 
          default: Date.now 
        },
        quality: { 
          type: Number, 
          required: true, 
          min: 0, 
          max: 5 
        }, // SM-2 feedback score (0-5)
        interval: { 
          type: Number 
        },
        easeFactor: { 
          type: Number 
        }
      }
    ]
  },
  { 
    timestamps: true 
  }
);

// Ensure a user has exactly one tracking schedule per concept per document
masteryConceptSchema.index({ userId: 1, documentId: 1, conceptName: 1 }, { unique: true });

export default mongoose.model('MasteryConcept', masteryConceptSchema);

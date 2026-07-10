import mongoose from 'mongoose';

const appErrorLogSchema = new mongoose.Schema(
  {
    errorId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
    },
    stack: {
      type: String,
    },
    statusCode: {
      type: Number,
      default: 500,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    source: {
      type: String,
      enum: ['api', 'worker'],
      required: true,
      index: true,
    },
    route: {
      type: String,
    },
    method: {
      type: String,
    },
    body: {
      type: mongoose.Schema.Types.Mixed,
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    isResolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('AppErrorLog', appErrorLogSchema);

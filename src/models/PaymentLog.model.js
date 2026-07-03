import mongoose from 'mongoose';

const paymentLogSchema = new mongoose.Schema(
  {
    eventId: { type: String, unique: true, index: true },
    reference: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    amount: { type: Number, required: true }, // Amount in kobo/cents
    plan: { type: String, enum: ['plus', 'pro'], required: true },
    status: { type: String, default: 'success' },
    rawPayload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.model('PaymentLog', paymentLogSchema);

import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.model.js';
import PaymentLog from '../models/PaymentLog.model.js';

/**
 * Helper to upgrade a user's subscription plan atomically
 */
const upgradeUserPlan = async (email, reference, planName, amount, eventId = null) => {
  const normalizedEmail = email.toLowerCase().trim();
  
  // Find user first to confirm existence
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    console.error(`[PAYMENT UPGRADE] User not found for email: ${normalizedEmail}`);
    return null;
  }

  // Atomically update user plan if they are not already on it
  const updatedUser = await User.findOneAndUpdate(
    { _id: user._id },
    { $set: { plan: planName } },
    { new: true }
  );

  // Log transaction to database as idempotency guard
  try {
    await PaymentLog.create({
      eventId: eventId || `verify_${reference}_${Date.now()}`,
      reference,
      email: normalizedEmail,
      amount,
      plan: planName,
      status: 'success'
    });
    console.log(`[PAYMENT UPGRADE] Successfully upgraded user ${normalizedEmail} to plan: ${planName}`);
  } catch (logError) {
    // If double write or duplicate reference occurs, catch here
    if (logError.code === 11000) {
      console.warn(`[PAYMENT UPGRADE] Reference ${reference} already logged in database.`);
    } else {
      console.error(`[PAYMENT UPGRADE] Failed to create payment log:`, logError.message);
    }
  }

  return updatedUser;
};

/**
 * POST /api/payments/verify
 * Verifies a transaction reference on demand (initiated by frontend callback)
 */
export const verifyTransaction = asyncHandler(async (req, res, next) => {
  const { reference, plan } = req.body;

  if (!reference || !plan) {
    return next(new AppError('Reference and plan are required', 400));
  }

  const normalizedPlan = plan.toLowerCase().trim();
  if (!['plus', 'pro'].includes(normalizedPlan)) {
    return next(new AppError('Invalid plan specified', 400));
  }

  // Check if reference has already been successfully processed
  const existingLog = await PaymentLog.findOne({ reference });
  if (existingLog) {
    // Already processed, fetch the current user and return success
    const user = await User.findOne({ email: existingLog.email });
    return res.status(200).json({
      status: 'success',
      message: 'Transaction already verified and processed',
      data: {
        plan: existingLog.plan,
        email: existingLog.email,
        user
      }
    });
  }

  const secretKey = env.paystack.secretKey;
  if (!secretKey) {
    return next(new AppError('Paystack secret key configuration is missing', 500));
  }

  try {
    const paystackUrl = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
    const response = await fetch(paystackUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PAYMENT VERIFY] Paystack verification API returned error: ${errorText}`);
      return next(new AppError('Failed to verify transaction with Paystack API', 400));
    }

    const payload = await response.json();
    if (!payload.status || payload.data.status !== 'success') {
      return next(new AppError(`Transaction failed verification. Paystack Status: ${payload.data?.status || 'unknown'}`, 400));
    }

    const { amount, customer } = payload.data;
    const email = customer.email;

    // Trigger atomic plan upgrade
    const updatedUser = await upgradeUserPlan(email, reference, normalizedPlan, amount);

    if (!updatedUser) {
      return next(new AppError('Payment verified, but user account could not be found', 404));
    }

    return res.status(200).json({
      status: 'success',
      message: 'Payment verified and subscription activated successfully',
      data: {
        plan: normalizedPlan,
        email,
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('[PAYMENT VERIFY] Unexpected error during verification:', error);
    return next(new AppError('An internal error occurred while verifying the payment', 500));
  }
});

/**
 * POST /api/payments/webhook
 * Production-grade Webhook receiver to verify signature and process plan renewals/upgrades asynchronously
 */
export const handlePaystackWebhook = async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  
  if (!signature) {
    console.warn('[PAYSTACK WEBHOOK] Missing x-paystack-signature header.');
    return res.status(401).send('Missing signature header');
  }

  const secretKey = env.paystack.secretKey;
  if (!secretKey) {
    console.error('[PAYSTACK WEBHOOK] Paystack secret key is missing from config.');
    return res.status(500).send('Secret key configuration missing');
  }

  // 1. Verify cryptographic signature using rawBody buffer
  const rawPayload = req.rawBody || JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(rawPayload)
    .digest('hex');

  if (hash !== signature) {
    console.warn('[PAYSTACK WEBHOOK] Invalid signature match attempt.');
    return res.status(401).send('Invalid signature');
  }

  const payload = req.body;
  const eventId = payload.data?.id || `webhook_${Date.now()}`;
  
  // 2. Check Idempotency log
  const existingLog = await PaymentLog.findOne({ 
    $or: [
      { eventId },
      { reference: payload.data?.reference }
    ]
  });
  
  if (existingLog) {
    console.log(`[PAYSTACK WEBHOOK] Event ${eventId} (ref: ${payload.data?.reference}) already processed. Skipping.`);
    return res.status(200).send('Event already processed');
  }

  // 3. Acknowledge receipt instantly to Paystack under 100ms
  res.status(200).send('Webhook received successfully');

  // 4. Perform processing asynchronously in the background
  (async () => {
    try {
      if (payload.event === 'charge.success') {
        const { reference, amount, customer, metadata } = payload.data;
        const email = customer.email;
        
        // Derive target plan from metadata, custom fields, or default to plus
        let targetPlan = 'plus';
        if (metadata && metadata.plan) {
          targetPlan = metadata.plan;
        } else if (amount >= 1499900) { // ₦14,999 in Kobo
          targetPlan = 'pro';
        }

        console.log(`[PAYSTACK WEBHOOK] Processing charge.success for ${email} (amount: ${amount}, reference: ${reference})`);
        await upgradeUserPlan(email, reference, targetPlan, amount, eventId);
      } else {
        console.log(`[PAYSTACK WEBHOOK] Ignored unsupported event type: ${payload.event}`);
      }
    } catch (bgError) {
      console.error('[PAYSTACK WEBHOOK ASYNC ERROR]:', bgError.message);
    }
  })();
};

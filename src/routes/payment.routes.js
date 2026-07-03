import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { verifyTransaction, handlePaystackWebhook } from '../controllers/payment.controller.js';

const router = Router();

// Route for frontend payment callbacks (requires student JWT authentication)
router.post('/verify', verifyJWT, verifyTransaction);

// Route for Paystack webhook triggers (no JWT authentication required, validated via HMAC signature)
router.post('/webhook', handlePaystackWebhook);

export default router;

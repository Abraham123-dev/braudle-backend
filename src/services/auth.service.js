import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import RefreshToken from '../models/RefreshToken.model.js';
import { redisClient } from '../config/redis.js';

/**
 * Service to handle secure token logic and DB persistence
 */
export const createAccessToken = (userId) =>
  jwt.sign({ id: userId }, env.jwt.secret, { expiresIn: env.jwt.expiresIn });

export const generateRefreshToken = async (userId, maxAgeMs) => {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await RefreshToken.create({
    userId,
    token: tokenHash,
    expiresAt: new Date(Date.now() + maxAgeMs),
  });

  return rawToken;
};

export const revokeToken = async (rawToken) => {
  if (!rawToken) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  
  return await RefreshToken.findOneAndUpdate(
    { token: tokenHash, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] },
    { revokedAt: new Date() }
  );
};

export const rotateRefreshToken = async (rawToken) => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();

  // Atomic update to mark as revoked to prevent TOCTOU race conditions
  const storedToken = await RefreshToken.findOneAndUpdate(
    {
      token: tokenHash,
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now } },
    { returnDocument: 'after' }
  );

  if (storedToken) return storedToken;

  // Detect Token Reuse (Security best practice)
  const reusedToken = await RefreshToken.findOne({ token: tokenHash });
  if (reusedToken && reusedToken.revokedAt) {
    // Grace period check: If the token was revoked less than 10 seconds ago,
    // it might be a concurrent request from the same client.
    const gracePeriodMs = 10 * 1000;
    const timeSinceRevocation = now.getTime() - reusedToken.revokedAt.getTime();
    if (timeSinceRevocation < gracePeriodMs) {
      console.log(`[AUTH] Allowed concurrent refresh within grace period for user: ${reusedToken.userId}`);
      return reusedToken; // Return the token to let the refresh succeed
    }

    // Potential reuse attack: Invalidate all sessions for this user
    console.warn(`[AUTH] Invalidation triggered by token reuse for user: ${reusedToken.userId}`);
    await RefreshToken.deleteMany({ userId: reusedToken.userId });
  }

  return null;
};

export const clearExpiredTokens = async (userId) => {
    return await RefreshToken.deleteMany({
        userId,
        $or: [
            { expiresAt: { $lt: new Date() } },
            { revokedAt: { $exists: true } }
        ]
    });
};

/**
 * Generates a cryptographically secure token, hashes it, and stores the hash in Redis.
 */
export const generateMagicToken = async (email) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Store hash with 15 minute TTL
  const key = `magic:${tokenHash}`;
  await redisClient.set(key, JSON.stringify({ email }), 'EX', 15 * 60);

  return rawToken;
};

/**
 * Verifies a raw token by hashing it and checking against Redis.
 */
export const verifyMagicToken = async (rawToken) => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const key = `magic:${tokenHash}`;

  const data = await redisClient.get(key);
  if (!data) return null;

  // Single-use enforcement: delete immediately
  await redisClient.del(key);
  return JSON.parse(data).email;
};

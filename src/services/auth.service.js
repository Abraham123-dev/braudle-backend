import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import RefreshToken from '../models/RefreshToken.model.js';

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

  // Find valid token and revoke it immediately (Rotation)
  const storedToken = await RefreshToken.findOneAndUpdate(
    {
      token: tokenHash,
      expiresAt: { $gt: now },
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
    },
    { revokedAt: now },
    { new: true }
  );

  return storedToken;
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

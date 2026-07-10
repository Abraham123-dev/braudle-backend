import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.model.js';
import Document from '../models/Document.model.js';
import Quiz from '../models/Quiz.model.js';
import Session from '../models/Session.model.js';
import AppErrorLog from '../models/AppErrorLog.model.js';
import { redisClient } from '../config/redis.js';

/**
 * Lighthouse Admin Login
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  if (email !== 'abrahamoluwaniyi50@gmail.com' || password !== 'braudleCEO') {
    throw new AppError('Invalid administrative credentials', 401);
  }

  // Issue token
  const token = jwt.sign({ email }, env.jwt.secret, { expiresIn: '12h' });

  // Set cookie
  res.cookie('braudle_admin_token', token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  });

  return res.status(200).json({
    status: 'success',
    token,
    message: 'Welcome back to the Lighthouse Dashboard, Abraham!'
  });
});

/**
 * Lighthouse Platform Analytics
 */
export const getStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    freeUsers,
    plusUsers,
    proUsers,
    allUsers,
    totalDocuments,
    pdfCount,
    imageCount,
    totalQuizzes,
    totalSessions
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ $or: [{ plan: 'free' }, { plan: { $exists: false } }] }),
    User.countDocuments({ plan: 'plus' }),
    User.countDocuments({ plan: 'pro' }),
    User.find().select('name email role plan lastUploadDate uploadCount dailyGenerationsCount createdAt').sort({ createdAt: -1 }),
    Document.countDocuments(),
    Document.countDocuments({ type: 'pdf' }),
    Document.countDocuments({ type: 'image' }),
    Quiz.countDocuments(),
    Session.countDocuments()
  ]);

  const mongoState = mongoose.connection.readyState;
  const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  const redisStatus = redisClient.status === 'ready' ? 'connected' : redisClient.status || 'disconnected';

  return res.status(200).json({
    status: 'success',
    users: {
      total: totalUsers,
      free: freeUsers,
      plus: plusUsers,
      pro: proUsers,
      list: allUsers
    },
    platform: {
      totalDocuments,
      pdfCount,
      imageCount,
      totalQuizzes,
      totalSessions
    },
    system: {
      mongodb: mongoStatus,
      redis: redisStatus
    }
  });
});

/**
 * Lighthouse Error House logs
 */
export const getErrorLogs = asyncHandler(async (req, res) => {
  const { isResolved, source, page = 1, limit = 20 } = req.query;

  const query = {};
  if (isResolved !== undefined) {
    query.isResolved = isResolved === 'true';
  }
  if (source) {
    query.source = source;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [logs, total] = await Promise.all([
    AppErrorLog.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    AppErrorLog.countDocuments(query)
  ]);

  return res.status(200).json({
    status: 'success',
    logs,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(total / parseInt(limit))
  });
});

/**
 * Resolve Error House Log
 */
export const resolveErrorLog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const log = await AppErrorLog.findByIdAndUpdate(
    id,
    {
      isResolved: true,
      resolvedAt: new Date()
    },
    { new: true }
  );

  if (!log) {
    throw new AppError('Error log not found', 404);
  }

  return res.status(200).json({
    status: 'success',
    log,
    message: 'Error resolved successfully'
  });
});

/**
 * Lighthouse Admin Logout
 */
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie('braudle_admin_token', {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/'
  });

  return res.status(200).json({
    status: 'success',
    message: 'Logged out of Lighthouse successfully'
  });
});

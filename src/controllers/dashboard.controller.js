import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import Quiz from '../models/Quiz.model.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import { getCached, setCached, CACHE_KEYS, CACHE_TTL } from '../utils/cache.js';

export const getPerformance = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Cache-aware: this is an expensive multi-join aggregation.
  // A 5-min stale window is fine — performance data doesn't change mid-session.
  const cacheKey = CACHE_KEYS.DASHBOARD_PERF(userId);
  const cached = await getCached(cacheKey);
  if (cached) {
    return res.status(200).json({ status: 'success', data: cached, fromCache: true });
  }

  // 1. Fetch all submitted quizzes for the user (via session)
  const sessions = await Session.find({ userId }).select('_id');
  const sessionIds = sessions.map(s => s._id);

  const quizzes = await Quiz.find({ 
    sessionId: { $in: sessionIds }, 
    score: { $exists: true } 
  }).populate('documentId', 'subject title');

  const totalQuizzes = quizzes.length;
  let averageScore = 0;
  
  const subjectMap = {};

  if (totalQuizzes > 0) {
    const totalScore = quizzes.reduce((acc, q) => acc + q.score, 0);
    averageScore = Math.round(totalScore / totalQuizzes);

    // Aggregate by subject
    quizzes.forEach(q => {
      const subject = q.documentId?.subject || 'General';
      if (!subjectMap[subject]) {
        subjectMap[subject] = { totalScore: 0, count: 0 };
      }
      subjectMap[subject].totalScore += q.score;
      subjectMap[subject].count += 1;
    });
  }

  const subjectPerformance = Object.keys(subjectMap).map(subject => ({
    subject,
    averageScore: Math.round(subjectMap[subject].totalScore / subjectMap[subject].count),
    quizzesTaken: subjectMap[subject].count
  }));

  const data = { totalQuizzes, averageScore, subjectPerformance };

  // Cache the aggregation result for 5 minutes
  await setCached(cacheKey, data, CACHE_TTL.DASHBOARD);

  res.status(200).json({ status: 'success', data, fromCache: false });
});

export const getRecommendations = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // 1. Ready to Test: Recent completed sessions that don't have a quiz yet
  const recentSessions = await Session.find({ 
    userId, 
    status: 'completed' 
  }).sort({ completedAt: -1 }).limit(5).populate('documentId', 'title subject');

  const readyToTest = [];
  for (const session of recentSessions) {
    if (!session.documentId) continue;
    const existingQuiz = await Quiz.findOne({ sessionId: session._id });
    if (!existingQuiz) {
      readyToTest.push({
        sessionId: session._id,
        documentId: session.documentId._id,
        title: session.documentId.title,
        subject: session.documentId.subject,
        reason: 'Based on recently completed modules'
      });
    }
  }

  // 2. Weak Spots Review: Documents with unresolved misconceptions
  const documents = await Document.find({ 
    userId, 
    'misconceptions.0': { $exists: true } 
  }).select('title subject misconceptions');

  const weakSpots = documents.map(doc => {
    const unresolved = doc.misconceptions.filter(m => !m.isResolved);
    if (unresolved.length > 0) {
      return {
        documentId: doc._id,
        title: doc.title,
        subject: doc.subject,
        weakTopics: unresolved.map(m => m.topic),
        reason: 'Targeted practice on concepts you struggled with recently'
      };
    }
    return null;
  }).filter(Boolean);

  res.status(200).json({
    status: 'success',
    data: {
      readyToTest: readyToTest.slice(0, 3),
      weakSpots: weakSpots.slice(0, 3)
    }
  });
});

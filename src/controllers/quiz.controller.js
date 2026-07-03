import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import Quiz from '../models/Quiz.model.js';
import Session from '../models/Session.model.js';
import Document from '../models/Document.model.js';
import User from '../models/User.model.js';
import * as QuizService from '../services/quiz.service.js';
import * as ProfileService from '../services/profile.service.js';
import * as AIService from '../services/ai.service.js';
import { calculateScore } from '../utils/scoreCalculator.js';
import { redisClient, isRedisHealthy } from '../config/redis.js';
import { deleteCached, CACHE_KEYS } from '../utils/cache.js';
import { parseAIJson } from '../utils/parseAIJson.js';

const stripAnswers = (questions) => questions.map((q) => ({
  _id: q._id,
  question: q.question,
  type: q.type,
  options: q.options,
}));

const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions)) return [];
  return questions.map((q) => {
    let type = (q.type || '').toLowerCase().trim();
    if (type === 'mcq' || type === 'm.c.q' || type === 'multiple_choice' || type === 'multiple choice') {
      type = 'mcq';
    } else if (type === 'true_false' || type === 'true/false' || type === 'true or false' || type === 'tf') {
      type = 'true_false';
    } else {
      type = 'theory';
    }
    return {
      ...q,
      type
    };
  });
};

// Helper to check and record generation limits
export const checkAndRecordGenLimit = async (user, document, type) => {
  const plan = user.plan || 'free';
  const now = new Date();

  if (plan === 'pro') {
    return; // Unlimited!
  }

  // Reset daily counts if a new day has started
  const lastReset = user.lastGenerationResetDate ? new Date(user.lastGenerationResetDate) : new Date(0);
  const isNewDay = lastReset.toDateString() !== now.toDateString();

  if (isNewDay) {
    user.dailyGenerationsCount = { flashcards: 0, practice: 0, exam: 0 };
    user.lastGenerationResetDate = now;
  }

  if (plan === 'plus') {
    // Plus limit: Max 5 generations per day globally
    const count = user.dailyGenerationsCount[type] || 0;
    if (count >= 5) {
      throw new AppError(`You've reached your daily limit of 5 ${type} generations for the Plus plan.`, 429);
    }
    user.dailyGenerationsCount[type] = count + 1;
    await user.save();
    return;
  }

  // Free limit: 1 generation every day per document
  const fieldMap = {
    flashcards: 'lastFlashcardGen',
    practice: 'lastPracticeGen',
    exam: 'lastExamGen'
  };
  const lastGenField = fieldMap[type];

  if (!document.sessionMemory) {
    document.sessionMemory = { flashcardsShown: [], questionsServed: [], practiceGuidesGenerated: [] };
  }

  const lastGenVal = document.sessionMemory[lastGenField];
  const lastGenTime = lastGenVal ? new Date(lastGenVal).getTime() : 0;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (lastGenTime > 0 && (Date.now() - lastGenTime < oneDayMs)) {
    const remainingMs = oneDayMs - (Date.now() - lastGenTime);
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    throw new AppError(`You've reached the limit. Free users can only generate 1 ${type} every day. Available in ${remainingHours}h.`, 429);
  }

  document.set(`sessionMemory.${lastGenField}`, now);
  document.markModified('sessionMemory');
  await document.save();
};

const generateAndSaveCacheOnTheFly = async (document) => {
  try {
    const { buildMasterKnowledgeCachePrompt } = await import('../utils/promptBuilder.js');
    const cachePrompt = buildMasterKnowledgeCachePrompt(document.chunks);
    const cacheResponse = await AIService.generateAIResponse({
      task: 'analysis',
      messages: [{ role: 'user', content: cachePrompt }],
      temperature: 0.2,
      max_tokens: 4096
    });
    const parsed = parseAIJson(cacheResponse, null);
    if (parsed) {
      document.knowledgeCache = {
        concepts: parsed.concepts || [],
        definitions: parsed.definitions || [],
        learningObjectives: parsed.learningObjectives || [],
        keyFacts: parsed.keyFacts || [],
        importantExamples: parsed.importantExamples || [],
        formulae: parsed.formulae || [],
        flashcards: parsed.flashcards || [],
        questionBank: parsed.questionBank || [],
        examTopics: parsed.examTopics || []
      };
      document.markModified('knowledgeCache');
      await document.save();
    }
  } catch (err) {
    console.error('Failed to generate cache on the fly:', err.message);
  }
};

const assembleQuizFromCache = (document, count, isExam, format) => {
  if (!document.knowledgeCache || !Array.isArray(document.knowledgeCache.questionBank) || document.knowledgeCache.questionBank.length === 0) {
    return null; 
  }

  let bank = [...document.knowledgeCache.questionBank];

  if (format === 'objective') {
    bank = bank.filter(q => q.type === 'mcq' || q.type === 'true_false');
  } else if (format === 'theory' || format === 'subjective') {
    bank = bank.filter(q => q.type === 'theory');
  }

  if (bank.length === 0) {
    bank = [...document.knowledgeCache.questionBank];
  }

  const served = document.sessionMemory?.questionsServed || [];
  let available = bank.filter(q => !served.includes(q.question));

  if (available.length < count) {
    available = bank;
    if (document.sessionMemory) {
      document.sessionMemory.questionsServed = [];
    }
  }

  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

  let selected = [];
  if (isExam) {
    const easy = available.filter(q => q.difficulty === 'easy');
    const medium = available.filter(q => q.difficulty === 'medium');
    const hard = available.filter(q => q.difficulty === 'hard');

    shuffle(easy);
    shuffle(medium);
    shuffle(hard);

    while (selected.length < count && (easy.length > 0 || medium.length > 0 || hard.length > 0)) {
      if (easy.length > 0) selected.push(easy.pop());
      if (selected.length < count && medium.length > 0) selected.push(medium.pop());
      if (selected.length < count && hard.length > 0) selected.push(hard.pop());
    }

    if (selected.length < count && available.length > 0) {
      const remainingAvailable = available.filter(q => !selected.map(s => s.question).includes(q.question));
      shuffle(remainingAvailable);
      selected.push(...remainingAvailable.slice(0, count - selected.length));
    }
  } else {
    shuffle(available);
    selected = available.slice(0, count);
  }

  if (!document.sessionMemory) {
    document.sessionMemory = { flashcardsShown: [], questionsServed: [], practiceGuidesGenerated: [] };
  }
  selected.forEach(q => {
    if (!document.sessionMemory.questionsServed.includes(q.question)) {
      document.sessionMemory.questionsServed.push(q.question);
    }
  });
  document.markModified('sessionMemory');

  return selected.map(q => ({
    question: q.question,
    type: q.type || 'mcq',
    options: q.options || [],
    answer: q.answer,
    explanation: q.explanation || '',
    topic: q.topic || ''
  }));
};

/**
 * Generate a new quiz for a session
 */
export const generateQuiz = asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.id;

  // Verify session belongs to user
  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError('Session not found or access denied', 404);

  const lockKey = `lock:quiz:generate:${sessionId}:${userId}`;
  if (isRedisHealthy()) {
    const isLocked = await redisClient.get(lockKey);
    if (isLocked) {
      throw new AppError('A quiz is already generating for this session. Please wait.', 429);
    }
    await redisClient.set(lockKey, 'locked', 'EX', 60);
  }

  try {
    const user = await User.findById(userId);
    if (!user) throw new AppError('User not found', 404);

    const document = await Document.findById(session.documentId);
    if (!document) throw new AppError('Document not found', 404);

    // Enforce practice generation limits
    await checkAndRecordGenLimit(user, document, 'practice');

    // Build cache if missing
    if (!document.knowledgeCache || !document.knowledgeCache.questionBank || document.knowledgeCache.questionBank.length === 0) {
      await generateAndSaveCacheOnTheFly(document);
    }

    // Attempt to assemble from cache
    const cachedQuestions = assembleQuizFromCache(document, 5, false, 'mixed');
    if (cachedQuestions && cachedQuestions.length > 0) {
      const mongoose = (await import('mongoose')).default;
      const questionsWithIds = cachedQuestions.map(q => ({
        _id: new mongoose.Types.ObjectId(),
        ...q
      }));

      const quiz = await Quiz.create({
        sessionId: session._id,
        documentId: session.documentId,
        isExam: false,
        questions: questionsWithIds,
        totalQuestions: questionsWithIds.length,
      });

      await document.save();

      return res.status(201).json({
        status: 'success',
        quiz: {
          ...quiz.toObject(),
          questions: stripAnswers(quiz.questions),
        },
      });
    }

    // Check if a quiz already exists for this session
    let existingQuiz = await Quiz.findOne({ sessionId });
    if (existingQuiz && existingQuiz.score === undefined) {
      return res.status(200).json({ 
        status: 'success', 
        quiz: { ...existingQuiz.toObject(), questions: stripAnswers(existingQuiz.questions) } 
      });
    }

    // Call the AI service as fallback
    const profile = await ProfileService.getProfile(userId);
    const quizData = await QuizService.generateQuiz(
      session.documentId, 
      profile, 
      5, 
      document?.topics || [],
      session._id.toString()
    );

    const questions = quizData.questions || quizData;
    const normalizedQuestions = normalizeQuestions(questions);

    const quiz = await Quiz.create({
      sessionId: session._id,
      documentId: session.documentId,
      isExam: false,
      questions: normalizedQuestions,
      totalQuestions: normalizedQuestions.length,
    });

    return res.status(201).json({
      status: 'success',
      quiz: {
        ...quiz.toObject(),
        questions: stripAnswers(quiz.questions),
      },
    });
  } catch (error) {
    throw error;
  } finally {
    if (isRedisHealthy()) {
      await redisClient.del(lockKey);
    }
  }
});

/**
 * Generate a custom practice assessment (exam/quiz)
 */
export const generateCustomAssessment = asyncHandler(async (req, res) => {
  const { documentId, sessionId, format, difficulty, numQuestions, isExam, instructions } = req.body;
  const userId = req.user.id;

  const document = await Document.findOne({ _id: documentId, userId });
  if (!document) throw new AppError('Document not found or access denied', 404);

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);

  let activeSessionId;
  if (sessionId) {
    const session = await Session.findOne({ _id: sessionId, userId, documentId });
    if (!session) throw new AppError('Session not found or access denied', 404);
    activeSessionId = session._id;
  } else {
    const session = await Session.create({
      userId,
      documentId,
      mode: format === 'theory' || difficulty === 'expert' ? 'prepare' : 'practice',
      status: 'active'
    });
    activeSessionId = session._id;
  }

  const lockKey = `lock:quiz:custom:${activeSessionId}:${userId}`;
  if (isRedisHealthy()) {
    const isLocked = await redisClient.get(lockKey);
    if (isLocked) {
      throw new AppError('An assessment is already generating for this session. Please wait.', 429);
    }
    await redisClient.set(lockKey, 'locked', 'EX', 60);
  }

  try {
    // Enforce generation limits
    const limitType = isExam ? 'exam' : 'practice';
    await checkAndRecordGenLimit(user, document, limitType);

    // We can only use the cached question bank if:
    // 1. There are no custom instructions.
    // 2. We are generating a standard practice quiz (not exam mode).
    // 3. The requested format is mixed or standard objective/theory that matches cache availability.
    const isStandardFormat = format === 'mixed' || format === 'objective' || format === 'theory' || format === 'subjective';
    const canUseCache = !instructions && !isExam && isStandardFormat;

    if (canUseCache) {
      const cachedQuestions = assembleQuizFromCache(document, numQuestions || 10, !!isExam, format || 'mixed');
      if (cachedQuestions && cachedQuestions.length > 0) {
        const mongoose = (await import('mongoose')).default;
        const questionsWithIds = cachedQuestions.map(q => ({
          _id: new mongoose.Types.ObjectId(),
          ...q
        }));

        const quiz = await Quiz.create({
          sessionId: activeSessionId,
          documentId: documentId,
          isExam: !!isExam,
          questions: questionsWithIds,
          totalQuestions: questionsWithIds.length,
        });

        await document.save();

        return res.status(201).json({
          status: 'success',
          quiz: {
            ...quiz.toObject(),
            questions: stripAnswers(quiz.questions),
          },
        });
      }
    }

    const quizData = await QuizService.generateCustomAssessment(documentId, { 
      format, 
      difficulty, 
      numQuestions,
      instructions,
      isExam: !!isExam,
      documentTopics: document.topics || []
    }, activeSessionId.toString());

    const questions = quizData.questions || quizData;
    const normalizedQuestions = normalizeQuestions(questions);

    const quiz = await Quiz.create({
      sessionId: activeSessionId,
      documentId: documentId,
      isExam: !!isExam,
      questions: normalizedQuestions,
      totalQuestions: normalizedQuestions.length,
    });

    return res.status(201).json({
      status: 'success',
      quiz: {
        ...quiz.toObject(),
        questions: stripAnswers(quiz.questions),
      },
    });
  } catch (error) {
    throw error;
  } finally {
    if (isRedisHealthy()) {
      await redisClient.del(lockKey);
    }
  }
});

// Helper for fast programmatic grading of MCQ/TrueFalse questions
const gradeMcqOrTrueFalse = (studentAns, correctAns, options = []) => {
  if (!studentAns || !correctAns) return false;
  const cleanStudent = studentAns.trim().toLowerCase();
  const cleanCorrect = correctAns.trim().toLowerCase();

  if (cleanStudent === cleanCorrect) return true;

  if (cleanCorrect === 'true' || cleanCorrect === 'false') {
    if (cleanStudent === 't' && cleanCorrect === 'true') return true;
    if (cleanStudent === 'f' && cleanCorrect === 'false') return true;
    return false;
  }

  const getLetterPrefix = (str) => {
    const match = str.match(/^([a-d])\s*[\.\)\:-]/i);
    return match ? match[1].toLowerCase() : null;
  };

  const studentPrefix = getLetterPrefix(studentAns);
  const correctPrefix = getLetterPrefix(correctAns);

  if (studentPrefix && correctPrefix && studentPrefix === correctPrefix) return true;
  if (studentAns.length === 1 && correctPrefix && cleanStudent === correctPrefix) return true;
  if (correctAns.length === 1 && studentPrefix && cleanCorrect === studentPrefix) return true;

  // Match using options index if available
  if (Array.isArray(options) && options.length > 0) {
    const studentIdx = options.findIndex(opt => opt.trim().toLowerCase() === cleanStudent);
    const correctIdx = options.findIndex(opt => opt.trim().toLowerCase() === cleanCorrect);

    const studentLetter = studentIdx !== -1 ? String.fromCharCode(97 + studentIdx) : null;
    const correctLetter = correctIdx !== -1 ? String.fromCharCode(97 + correctIdx) : null;

    const cleanCorrectLetterOnly = cleanCorrect.replace(/[\.\)\:-]/g, '').trim();
    if (cleanCorrectLetterOnly.length === 1 && studentLetter && cleanCorrectLetterOnly === studentLetter) {
      return true;
    }

    const cleanStudentLetterOnly = cleanStudent.replace(/[\.\)\:-]/g, '').trim();
    if (cleanStudentLetterOnly.length === 1 && correctLetter && cleanStudentLetterOnly === correctLetter) {
      return true;
    }

    if (studentLetter && correctLetter && studentLetter === correctLetter) {
      return true;
    }
  }

  const stripPrefix = (str) => str.replace(/^([a-d])\s*[\.\)\:-]\s*/i, '').trim().toLowerCase();
  if (stripPrefix(studentAns) === stripPrefix(correctAns)) return true;

  return false;
};

/**
 * Submit answers and grade the quiz using zero-cost embeddings
 */
export const submitQuiz = asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const { answers } = req.body; // Array of { questionId, answer }
  const userId = req.user.id;

  // Fetch the quiz and populate session to verify ownership
  const quiz = await Quiz.findById(quizId).populate('sessionId');
  if (!quiz) throw new AppError('Quiz not found', 404);
  if (quiz.sessionId.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }
  if (quiz.score !== undefined) {
    throw new AppError('Quiz has already been submitted', 400);
  }

  // Grade each answer in parallel
  await Promise.all(quiz.questions.map(async (q) => {
    const studentSubmission = answers.find(a => a.questionId.toString() === q._id.toString());

    if (studentSubmission) {
      q.studentAnswer = studentSubmission.answer;

      if (q.type === 'mcq' || q.type === 'true_false') {
        q.isCorrect = gradeMcqOrTrueFalse(q.studentAnswer, q.answer, q.options);
        q.feedback = q.isCorrect 
          ? "Excellent! Your answer is correct." 
          : `Incorrect. The correct option was: ${q.answer}.`;
      } else {
        const result = await AIService.evaluateTheoryAnswer(
          q.question,
          q.studentAnswer,
          q.answer
        );
        q.isCorrect = result.evaluation === 'correct' || result.evaluation === 'partial';
        q.feedback = result.feedback;
      }
    } else {
      q.studentAnswer = '';
      q.isCorrect = false;
      q.feedback = 'No answer was submitted for this question.';
    }
  }));

  // Calculate score
  const score = calculateScore(quiz.questions);
  quiz.score = score;
  quiz.submittedAt = new Date();

  await quiz.save();

  // Handle potential level upgrade and XP
  const newLevel = await ProfileService.updateProfileAfterQuiz(userId, score, quiz.questions);

  // Invalidate performance cache so the dashboard reflects the new score immediately
  await deleteCached(CACHE_KEYS.DASHBOARD_PERF(userId));

  res.status(200).json({
    status: 'success',
    score: quiz.score,
    quiz,
    newLevel
  });
});

/**
 * Grade a single question in real-time
 */
export const gradeQuestion = asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const { questionId, answer } = req.body;
  const userId = req.user.id;

  const quiz = await Quiz.findById(quizId).populate('sessionId');
  if (!quiz) throw new AppError('Quiz not found', 404);
  if (quiz.sessionId.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  const question = quiz.questions.id(questionId);
  if (!question) throw new AppError('Question not found in this quiz', 404);

  let isCorrect = false;
  let feedback = '';

  if (question.type === 'mcq' || question.type === 'true_false') {
    isCorrect = gradeMcqOrTrueFalse(answer, question.answer, question.options);
    feedback = isCorrect 
      ? "Excellent! Your answer is correct." 
      : `Incorrect. The correct option was: ${question.answer}.`;
  } else {
    const result = await AIService.evaluateTheoryAnswer(
      question.question,
      answer,
      question.answer
    );
    isCorrect = result.evaluation === 'correct' || result.evaluation === 'partial';
    feedback = result.feedback;
  }

  // Update question values
  question.studentAnswer = answer;
  question.isCorrect = isCorrect;
  question.feedback = feedback;

  // Check if all questions are answered, if so calculate and save score
  const allAnswered = quiz.questions.every(q => q.studentAnswer && q.studentAnswer.trim().length > 0);
  let newLevel = null;
  if (allAnswered) {
    const score = calculateScore(quiz.questions);
    quiz.score = score;
    quiz.submittedAt = new Date();
    newLevel = await ProfileService.updateProfileAfterQuiz(userId, score, quiz.questions);
    
    // Invalidate performance cache so the dashboard reflects the new score immediately
    await deleteCached(CACHE_KEYS.DASHBOARD_PERF(userId));
  }

  await quiz.save();

  res.status(200).json({
    status: 'success',
    isCorrect,
    correctAnswer: question.answer,
    feedback,
    explanation: question.explanation || '',
    quizScore: quiz.score,
    newLevel
  });
});

/**
 * Get the user's quiz history
 */
export const getQuizHistory = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Find all sessions for user
  const sessions = await Session.find({ userId }).select('_id');
  const sessionIds = sessions.map(s => s._id);

  // Find quizzes matching those sessions
  const quizzes = await Quiz.find({ sessionId: { $in: sessionIds } })
    .populate('documentId', 'title subject')
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: quizzes.length,
    quizzes
  });
});

/**
 * Get a specific quiz detail
 */
export const getQuiz = asyncHandler(async (req, res) => {
  const { quizId } = req.params;
  const userId = req.user.id;

  const quiz = await Quiz.findById(quizId).populate('sessionId');
  if (!quiz) throw new AppError('Quiz not found', 404);
  
  if (quiz.sessionId.userId.toString() !== userId) {
    throw new AppError('Forbidden: Access denied', 403);
  }

  let returnedQuiz = quiz.toObject();
  if (returnedQuiz.score === undefined) {
    returnedQuiz.questions = stripAnswers(returnedQuiz.questions);
  }

  res.status(200).json({ status: 'success', quiz: returnedQuiz });
});

/**
 * Get quizzes generated for a specific session
 */
export const getSessionQuizzes = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const userId = req.user.id;

  const session = await Session.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError('Session not found', 404);

  const quizzes = await Quiz.find({ sessionId })
    .populate('documentId', 'title')
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: quizzes.length,
    quizzes
  });
});

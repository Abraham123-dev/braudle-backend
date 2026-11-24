export const getAbuseLimitConfig = (isDev) => ({
  presign: {
    windowMs: 60 * 1000,
    max: isDev ? 100 : 5,
  },
  quizGeneration: {
    windowMs: 60 * 1000,
    max: isDev ? 100 : 10,
  },
});

export const getGlobalLimiterConfig = (isDev) => ({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 300,
});

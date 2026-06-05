// Calculates quiz scores and determines correctness

const calculateScore = (questions) => {
  if (!questions || questions.length === 0) return 0;
  
  const correct = questions.filter(q => q.isCorrect === true).length;
  return Math.round((correct / questions.length) * 100);
};

const determineLevel = (averageScore) => {
  if (averageScore >= 80) return 'advanced';
  if (averageScore >= 60) return 'intermediate';
  return 'beginner';
};

const shouldUpgradeLevel = (currentLevel, recentScores) => {
  if (recentScores.length < 3) return false;
  const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  return avg >= 80 && currentLevel !== 'advanced';
};

const calculateXP = (score) => {
  // Base XP is the score itself
  let xp = score;
  // Bonus XP for high scores
  if (score >= 90) xp += 50;
  else if (score >= 80) xp += 20;
  return Math.round(xp);
};

export { calculateScore, determineLevel, shouldUpgradeLevel, calculateXP };


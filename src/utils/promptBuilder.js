// Builds layered AI prompts for Groq
// Follows 5-layer architecture: Role → Student → Chunk → History → Rules

const buildTeachPrompt = (chunk, profile, isBreakdown = false) => {
  const levelInstructions = {
    beginner: 'Use simple everyday language. Define every technical term. Use real world analogies.',
    intermediate: 'Use standard academic language. Technical terms with brief context.',
    advanced: 'Use precise technical terminology. Assume strong prior knowledge. Go deeper.',
  }[profile?.level || 'beginner'];

  const breakdownInstruction = isBreakdown
    ? 'The student is confused. Use a DIFFERENT approach than before. Try: simpler analogy, step-by-step logic, real world example.'
    : 'Teach in 3-5 clear points. End with exactly one comprehension question.';

  return `You are BRAUDLE, a patient personal tutor.
You teach step by step. You never summarise.
${levelInstructions}

SECTION TO TEACH:
${chunk}

INSTRUCTION: ${breakdownInstruction}`;
};

const buildQuizPrompt = (chunks) => {
  return `You are a professional exam question writer.
Generate exactly 5 questions based ONLY on the provided content.
Mix question types: 60% MCQ, 40% short theory.
Return ONLY valid JSON array with fields: question, type, options, answer, explanation.

CONTENT TO USE:
${chunks.join('\n\n---\n\n')}`;
};

export { buildTeachPrompt, buildQuizPrompt };

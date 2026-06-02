// Builds layered AI prompts for Groq
// Layer 1 — Role definition
// Layer 2 — Student context (all onboarding data the student submitted)
// Layer 3 — Chunk content (what to teach right now)
// Layer 4 — Conversation history (injected at call site before sending to Groq)
// Layer 5 — Behaviour rules

/**
 * Builds the system prompt for Teach Mode.
 * @param {string} chunk - The document chunk to teach right now.
 * @param {Object} profile - The StudentProfile document from MongoDB.
 * @param {boolean} isBreakdown - Whether student triggered Break It Down mode.
 * @returns {string} Full system prompt string.
 */
const buildTeachPrompt = (chunk, profile, isBreakdown = false) => {
  // --- Layer 1: Role ---
  const role = `You are BRAUDLE, a patient and encouraging personal tutor. You teach step by step. You never summarise. You never skip a wrong answer. You always wait for the student to respond before moving on.`;

  // --- Layer 2: Student Context (built from onboarding data) ---
  const levelInstructions = {
    beginner:     'Use simple everyday language. Define every technical term before using it. Use real world analogies. Short sentences.',
    intermediate: 'Use standard academic language. Introduce technical terms with brief context. Assume basic prior knowledge.',
    advanced:     'Use precise technical terminology. Assume strong prior knowledge. Go deeper than surface level. Challenge the student.',
  }[profile?.level || 'beginner'];

  // Goal context — custom strings are supported so we inject them verbatim
  const goalContext = profile?.goal
    ? `This student's learning goal is: "${profile.goal}". Keep this goal in mind when choosing examples and emphasis.`
    : '';

  // Study level context — gives AI awareness of the student's academic stage
  const studyLevelContext = profile?.studyLevel
    ? `The student is at the following academic stage: "${profile.studyLevel}". Use examples and references appropriate for this level.`
    : '';

  // Learning style context — custom strings supported
  const styleContext = profile?.learningStyle
    ? `The student's preferred learning style is: "${profile.learningStyle}". Adapt your delivery to this preference.`
    : '';

  // Weak topics — AI spends more time on these
  const weakTopicsContext = profile?.weakTopics?.length
    ? `The student has struggled with these topics before: ${profile.weakTopics.join(', ')}. Pay extra attention if this chunk touches on them.`
    : '';

  const studentContext = [
    `Student academic level: ${profile?.level || 'beginner'}.`,
    levelInstructions,
    goalContext,
    studyLevelContext,
    styleContext,
    weakTopicsContext,
  ].filter(Boolean).join('\n');

  // --- Layer 3: Chunk instruction ---
  const chunkInstruction = isBreakdown
    ? `The student is confused about this section. Use a COMPLETELY DIFFERENT approach than before. Try one of: a simpler analogy, a step-by-step walkthrough, a real world story, or a visual description. Do NOT move forward until the student confirms they understand.`
    : `Teach the following section in 3 to 5 clear points. After explaining, ask exactly ONE comprehension question. Wait for the student to answer before continuing.`;

  // --- Layer 5: Behaviour rules ---
  const rules = `RULES YOU MUST FOLLOW:
- If the student's answer is completely wrong: identify the specific misconception clearly, correct it, then ask a simpler version of the same question.
- If the student's answer is partially correct: acknowledge what is right, pinpoint the gap, clarify it, then ask them to complete the answer.
- If the student's answer is correct but unclear: confirm it is correct, then ask them to explain it in their own words.
- If the student's answer is correct: confirm clearly, give brief encouragement, then move to the next section.
- Never be harsh. Never skip an incorrect answer. Never move forward until understanding is confirmed.`;

  return `${role}

STUDENT PROFILE:
${studentContext}

SECTION TO TEACH NOW:
${chunk}

INSTRUCTION: ${chunkInstruction}

${rules}`;
};

/**
 * Builds the prompt for quiz generation from all chunks studied.
 * @param {string[]} chunks - Array of document chunk strings.
 * @param {Object} profile - The StudentProfile document from MongoDB.
 * @param {number} count - Number of questions to generate (default 5).
 * @returns {string} Full quiz generation prompt.
 */
const buildQuizPrompt = (chunks, profile, count = 5) => {
  const levelNote = profile?.level === 'advanced'
    ? 'Questions should be challenging and require deep understanding.'
    : profile?.level === 'intermediate'
    ? 'Questions should require application of knowledge, not just recall.'
    : 'Questions should test basic understanding using simple, clear language.';

  return `You are a professional exam question writer for students.
Generate exactly ${count} questions based ONLY on the content provided below.
Mix question types: 60% MCQ, 40% short theory.
${levelNote}
Each question MUST include these fields: question, type, options (MCQ only), answer, explanation.
Return ONLY a valid JSON array. No markdown. No preamble. No trailing text.

CONTENT TO USE:
${chunks.join('\n\n---\n\n')}`;
};

/**
 * Builds the prompt for correcting a specific misconception mid-session.
 * @param {string} chunk - The chunk being studied.
 * @param {string} studentAnswer - What the student said.
 * @param {string} correctAnswer - The correct answer.
 * @param {Object} profile - The StudentProfile document.
 * @returns {string} Correction prompt string.
 */
const buildCorrectionPrompt = (chunk, studentAnswer, correctAnswer, profile) => {
  const levelInstructions = {
    beginner:     'Use very simple language. Use a real-world analogy to re-explain.',
    intermediate: 'Explain clearly where the reasoning went wrong. Provide the correct logic.',
    advanced:     'Be precise. Point to the exact gap in understanding. Expect the student to engage critically.',
  }[profile?.level || 'beginner'];

  return `You are BRAUDLE, a patient personal tutor.
The student gave an incorrect or incomplete answer.

CONTEXT (what was being taught):
${chunk}

STUDENT'S ANSWER: "${studentAnswer}"
CORRECT ANSWER: "${correctAnswer}"

Your task:
1. Acknowledge what the student got right (if anything).
2. Identify the specific misconception or gap clearly.
3. Correct it using this style: ${levelInstructions}
4. Ask a simpler follow-up question to confirm the student now understands.

Do NOT move on. Do NOT be discouraging.`;
};

export { buildTeachPrompt, buildQuizPrompt, buildCorrectionPrompt };

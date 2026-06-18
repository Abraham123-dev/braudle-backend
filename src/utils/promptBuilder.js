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
 * @param {string} mode - The interaction mode ('teach', 'breakdown', 'quiz', 'exam', 'chat', 'flashcards').
 * @returns {string} Full system prompt string.
 */
const buildTeachPrompt = (chunk, profile, mode = 'understand') => {
  // --- Layer 1: Role ---
  const role = `You are BRAUDLE, an expert mentor and adaptive tutor. Your goal is to guide the student toward mastery. You act as a mentor: observing progress, answering questions, and suggesting the best next steps rather than just following a rigid script.`;

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

  // Detailed Misconceptions — AI knows exactly what to fix
  const misconceptionsContext = profile?.misconceptionHistory?.length
    ? `The student has had specific misunderstandings recently:
${profile.misconceptionHistory.slice(-5).map(m => `- ${m.topic}: ${m.description}`).join('\n')}
If the current section relates to these, proactively address the misconceptions and ensure they are cleared up.`
    : profile?.weakTopics?.length
    ? `The student has struggled with these general topics before: ${profile.weakTopics.join(', ')}. Pay extra attention if this chunk touches on them.`
    : '';

  const studentContext = [
    `Student academic level: ${profile?.level || 'beginner'}.`,
    levelInstructions,
    goalContext,
    studyLevelContext,
    styleContext,
    misconceptionsContext,
  ].filter(Boolean).join('\n');

  // --- Layer 3: Chunk instruction ---
  const modeInstructions = {
    understand: `Mode: Understand. Explain the following section step-by-step in 3 to 5 clear points, using analogies or real-world examples. End by asking exactly ONE comprehension question. If the student is confused or requests a simpler explanation, adapt your approach.`,
    review: `Mode: Review. Help the student revisit the key takeaways from this section. Summarize the major concepts and highlight important terms, dates, formulas, or definitions.`,
    practice: `Mode: Practice. Actively test the student's knowledge. Ask one question based on this section, evaluate their answer, and provide encouraging feedback.`,
    prepare: `Mode: Prepare. You are an exam supervisor. Ask one rigorous, exam-level question about this section. Do not give hints, encouragement, or custom feedback. Keep the tone formal and academic.`,
    ask: `Mode: Ask Anything. Answer the student's questions about this section directly. Let them lead the discussion and ask whatever they want.`,
    flashcards: `Mode: Flashcard Generation. Extract the most important facts, definitions, and concepts from this section. Present them as a list of "Front: [Question/Term]" and "Back: [Answer/Definition]". Keep them concise and focused on active recall.`,
  };

  const chunkInstruction = modeInstructions[mode] || modeInstructions.understand;

  // --- Layer 5: Behaviour rules ---
  const rules = `RULES YOU MUST FOLLOW:
- MENTORSHIP PROTOCOL: If the student has successfully answered 2-3 questions correctly in a row and demonstrates mastery of the current section, DO NOT automatically move to the next section. Instead, congratulate them and SUGGEST a next step (e.g., "You've got this! Want to try a quick Quiz, generate some Flashcards, or should we keep teaching?").
- If the student asks a specific question about the material, answer it immediately and thoroughly before continuing with your mode-specific instruction.
- If the student asks to summarize, explain a different part of the document, or just wants to chat about the topic, prioritize that request.
- If the student's answer is completely wrong: identify the specific misconception clearly, correct it, then ask a simpler version of the same question.
- If the student's answer is partially correct: acknowledge what is right, pinpoint the gap, clarify it, then ask them to complete the answer.
- If the student's answer is correct but unclear: confirm it is correct, then ask them to explain it in their own words.
- If the student's answer is correct: confirm clearly and give brief encouragement.
- Never be harsh. Never skip an incorrect answer. Never move forward to a new section of the document until the student agrees or understanding is confirmed.`;

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
 * @param {string[]} documentTopics - Available topics for the document.
 * @returns {string} Full quiz generation prompt.
 */
const buildQuizPrompt = (chunks, profile, count = 5, documentTopics = []) => {
  const levelNote = profile?.level === 'advanced'
    ? 'Questions should be challenging and require deep understanding.'
    : profile?.level === 'intermediate'
    ? 'Questions should require application of knowledge, not just recall.'
    : 'Questions should test basic understanding using simple, clear language.';

  const topicsNote = documentTopics.length > 0 
    ? `STRICT REQUIREMENT: Map each question to exactly one topic from this list: [${documentTopics.join(', ')}]. Do not create new topics.`
    : 'Assign a specific topic name (1-3 words) to each question based on its content.';

  return `You are a professional exam question writer for students.
Generate exactly ${count} questions based ONLY on the content provided below.
Mix question types: 60% MCQ, 40% short theory.
${levelNote}
Each question MUST include these fields: topic, question, type, options (MCQ only), answer, explanation.
${topicsNote}
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

/**
 * Builds the prompt for extracting a session summary, weak topics, and strong topics from a transcript.
 * @param {Object[]} messages - The conversation history array.
 * @param {string[]} documentTopics - List of valid topics for this document.
 * @returns {string} Extraction prompt string.
 */
const buildSessionAnalysisPrompt = (messages, documentTopics = []) => {
  // Safety: Limit transcript to the last 50 messages to stay within token limits
  // and focus on the most relevant part of the session.
  const transcript = messages
    .filter(m => m.role !== 'system')
    .slice(-50) 
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const topicsNote = documentTopics.length > 0
    ? `STRICT REQUIREMENT: Map findings to these topics: [${documentTopics.join(', ')}].`
    : 'Identify specific topics based on the transcript.';

  return `You are an expert educational analyst reviewing a completed tutoring session.
Analyze the following transcript between the AI tutor and the student.
${topicsNote}

Your task is to identify:
1. weakTopics: An array of topics the student struggled with or got wrong.
2. strongTopics: An array of topics the student mastered or understood well.
3. misconceptions: An array of objects with { topic, description } detailing exactly what the student misunderstood.
4. summary: A brief 2-3 sentence overview of the session performance.

Return ONLY a valid JSON object. No markdown. No preamble. No trailing text. No explanations.
Schema:
{
  "weakTopics": ["Topic A", "Topic B"],
  "strongTopics": ["Topic C"],
  "misconceptions": [
    { "topic": "Topic A", "description": "Student believes the mitochondria produces glucose instead of ATP." }
  ],
  "summary": "String describing the session outcome"
}

TRANSCRIPT:
${transcript}`;
};

/**
 * Builds the prompt for custom practice quizzes or exams.
 * @param {string[]} chunks - Document chunks
 * @param {Object} options - Custom parameters (format, difficulty, numQuestions, documentTopics)
 * @returns {string} Custom assessment prompt.
 */
const buildCustomAssessmentPrompt = (chunks, options) => {
  const { format, difficulty, numQuestions, documentTopics = [] } = options;

  let difficultyNote = '';
  switch(difficulty) {
    case 'easy': difficultyNote = 'Focus on basic recall and definitions. Simple vocabulary.'; break;
    case 'medium': difficultyNote = 'Test comprehension and basic application. Standard difficulty.'; break;
    case 'hard': difficultyNote = 'Test analysis and deep understanding. Require connecting concepts.'; break;
    case 'expert': difficultyNote = 'Rigorous, exam-level difficulty. Test evaluation and synthesis of complex ideas.'; break;
    default: difficultyNote = 'Standard difficulty.';
  }

  let formatNote = '';
  if (format === 'objective') formatNote = 'ALL questions MUST be multiple choice (mcq) or true_false.';
  else if (format === 'subjective') formatNote = 'ALL questions MUST be short answer theory (theory).';
  else if (format === 'theory') formatNote = 'ALL questions MUST be long-form conceptual essays (theory) with detailed answers expected.';
  else formatNote = 'Mix question types: 60% MCQ, 40% short theory.';

  const topicsNote = documentTopics.length > 0 
    ? `Map each question to one of these topics: ${documentTopics.join(', ')}.`
    : 'Assign a specific topic name (1-3 words) to each question based on its content.';

  return `You are an expert exam setter.
Generate exactly ${numQuestions} questions based ONLY on the content provided below.

DIFFICULTY LEVEL: ${difficulty.toUpperCase()}
${difficultyNote}

FORMAT REQUIREMENT:
${formatNote}

Each question MUST include these fields: topic, question, type (mcq/true_false/theory), options (only for mcq), answer, explanation.
${topicsNote}
Return ONLY a valid JSON array. No markdown. No preamble. No trailing text.

CONTENT TO USE:
${chunks.join('\n\n---\n\n')}`;
};

export { buildTeachPrompt, buildQuizPrompt, buildCorrectionPrompt, buildSessionAnalysisPrompt, buildCustomAssessmentPrompt, buildDocumentUnderstandingPrompt };

/**
 * Builds the prompt for AI document understanding.
 * Used by the background worker AFTER chunking to extract topics and a summary.
 * @param {string[]} chunks - All document chunks.
 * @returns {string} Document understanding prompt.
 */
function buildDocumentUnderstandingPrompt(chunks) {
  let sampleChunks = [];
  const headCount = 5; // Number of chunks to take from the beginning
  const tailCount = 5; // Number of chunks to take from the end
  const minChunksForSplit = headCount + tailCount;

  if (chunks.length <= minChunksForSplit) {
    // If the document is small, use all chunks
    sampleChunks = chunks;
  } else {
    // Take 'headCount' chunks from the beginning and 'tailCount' from the end
    sampleChunks = chunks.slice(0, headCount).concat(chunks.slice(-tailCount));
  }

  const sample = sampleChunks.join('\n\n---\n\n');

  return `You are an expert curriculum analyst and educational content specialist.
A student has uploaded a study document to an AI tutoring platform.
Your job is to read this document and prepare a structured learning profile for the AI tutor.

Your task is to:
1. Identify the main academic TOPICS covered in this document (3 to 8 topics, each 2-5 words).
2. Write a plain-English SUMMARY of the document (2-4 sentences, student-friendly, no jargon).

Return ONLY a valid JSON object. No markdown. No preamble. No trailing text.
Schema:
{
  "topics": ["Topic One", "Topic Two", "Topic Three"],
  "summary": "This document covers..."
}

DOCUMENT CONTENT:
${sample}`;
}

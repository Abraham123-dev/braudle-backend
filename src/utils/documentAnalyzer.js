/**
 * documentAnalyzer.js
 *
 * Lightweight, zero-cost heuristic utility that analyses document chunks or
 * raw text to detect whether the uploaded material is a question/exam sheet
 * rather than (or in addition to) normal study notes.
 *
 * Deliberately uses no AI calls — this is purely pattern-based so it is
 * instant, free, and can run inside the background worker without consuming
 * any provider token budget.
 */

/**
 * Question-type signal patterns.
 *
 * Each entry is a regex that, when found inside the text, increments a
 * confidence score.  The weight value represents how strong a signal it is.
 */
const QUESTION_PATTERNS = [
  // Numbered/lettered question starters  e.g. "1.", "Q1.", "Question 3:"
  { pattern: /^\s*(q(?:uestion)?\s?\d+[\.\):]|(?:\d{1,3}[\.\)])\s+\w)/im,  weight: 2 },
  // Lettered sub-options e.g.  "a)", "B.", "(c)"
  { pattern: /^\s*[\(\[]?\s*[a-dA-D]\s*[\)\.](\s+\w|\s*$)/m,                weight: 2 },
  // Explicit question/answer labels
  { pattern: /\b(?:answer|ans|solution)\s*:/i,                               weight: 3 },
  // Instruction phrases common in worksheets
  { pattern: /\b(?:solve the following|answer the following|answer all|complete the following|fill in the blank|true or false|circle the correct|select the best|which of the following|choose the (?:correct|best))\b/i, weight: 3 },
  // Multiple-choice explicit labels
  { pattern: /\bmultiple[\s-]?choice\b/i,                                    weight: 4 },
  // Marks/points allocation  e.g.  "[5 marks]", "(2 points)"
  { pattern: /[\[\(]\d+\s*(?:marks?|points?|pts?)[\]\)]/i,                  weight: 3 },
  // Blank answer lines  "___" or dotted lines "....." used in worksheets
  { pattern: /_{4,}|\.{5,}/,                                                 weight: 1 },
  // Common exam header words
  { pattern: /\b(?:examination|exam paper|test paper|past paper|midterm|final exam|quiz sheet|assignment)\b/i, weight: 4 },
  // Question mark density — captured separately (see function below)
];

/**
 * Analyses document chunks (or a single raw text string) and returns a boolean
 * indicating whether the document appears to be a question/exam sheet.
 *
 * @param {string | string[]} chunksOrText  Either an array of chunk strings or
 *                                          a single raw text string.
 * @returns {boolean}  true if the document is likely a question/exam sheet.
 */
export const detectQuestionsInDocument = (chunksOrText) => {
  if (!chunksOrText) return false;

  // Normalise input — join chunks into a single body for pattern matching,
  // but also keep individual chunks for density analysis.
  const chunks = Array.isArray(chunksOrText) ? chunksOrText : [chunksOrText];
  const fullText = chunks.join('\n');

  if (!fullText || fullText.trim().length < 50) return false;

  let score = 0;

  // Run each pattern against the full text
  for (const { pattern, weight } of QUESTION_PATTERNS) {
    if (pattern.test(fullText)) {
      score += weight;
    }
  }

  // Question mark density check — if > 2% of lines end with "?", add signal
  const lines = fullText.split('\n').filter(l => l.trim().length > 0);
  const questionMarkLines = lines.filter(l => l.trim().endsWith('?')).length;
  const density = lines.length > 0 ? questionMarkLines / lines.length : 0;
  if (density > 0.02) score += Math.min(Math.floor(density * 20), 5);

  // Threshold: score >= 5 means we are confident this is a question/exam document
  const isQuestionDoc = score >= 5;

  if (isQuestionDoc) {
    console.log(`[DOCUMENT ANALYZER] Question document detected (confidence score: ${score}).`);
  }

  return isQuestionDoc;
};

export const GROQ_MODELS = {
  smart:  'llama-3.3-70b-versatile',
  fast:   'llama-3.1-8b-instant',
  vision: 'qwen/qwen3.6-27b',
};

export const MODEL_ROUTING = {
  // Groq Smart
  teachChunk:            GROQ_MODELS.smart,
  correctMisconception:  GROQ_MODELS.smart,
  generateQuiz:          GROQ_MODELS.smart,
  flashcards:            GROQ_MODELS.smart,
  
  // Groq Fast
  detectConfusion:       GROQ_MODELS.fast,
  generateCheckQuestion: GROQ_MODELS.fast,
  sessionSummary:        GROQ_MODELS.fast,
  evaluateAnswer:        GROQ_MODELS.fast,
  classifyIntent:        GROQ_MODELS.fast,
  
  // Groq Vision
  transcribeHandwriting: GROQ_MODELS.vision,
};
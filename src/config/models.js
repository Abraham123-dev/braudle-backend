export const GROQ_MODELS = {
  smart:  'llama-3.3-70b-versatile',
  fast:   'llama-3.1-8b-instant',
  vision: 'llama-3.2-11b-vision-preview',
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
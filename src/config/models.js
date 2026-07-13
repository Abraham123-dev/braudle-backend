export const GROQ_MODELS = {
  smart:  process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile',
  fast:   process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant',
  vision: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
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

export const PROVIDER_MODEL_MAPPING = {
  groq: {
    tutoring: process.env.MODEL_GROQ_TUTORING || 'llama-3.3-70b-versatile',
    analysis: process.env.MODEL_GROQ_ANALYSIS || 'llama-3.1-8b-instant',
    vision: process.env.MODEL_GROQ_VISION || 'qwen/qwen3.6-27b',
    general_chat: process.env.MODEL_GROQ_GENERAL_CHAT || 'llama-3.3-70b-versatile'
  },
  groq_secondary: {
    tutoring: process.env.MODEL_GROQ_SECONDARY_TUTORING || 'llama-3.3-70b-versatile',
    analysis: process.env.MODEL_GROQ_SECONDARY_ANALYSIS || 'llama-3.1-8b-instant',
    vision: process.env.MODEL_GROQ_SECONDARY_VISION || 'qwen/qwen3.6-27b',
    general_chat: process.env.MODEL_GROQ_SECONDARY_GENERAL_CHAT || 'llama-3.3-70b-versatile'
  },
  openrouter: {
    tutoring: process.env.MODEL_OPENROUTER_TUTORING || 'deepseek/deepseek-chat',
    analysis: process.env.MODEL_OPENROUTER_ANALYSIS || 'qwen/qwen-2.5-72b-instruct',
    vision: process.env.MODEL_OPENROUTER_VISION || 'meta-llama/llama-3.2-11b-vision-instruct',
    general_chat: process.env.MODEL_OPENROUTER_GENERAL_CHAT || 'deepseek/deepseek-chat'
  },
  mistral: {
    tutoring: process.env.MODEL_MISTRAL_TUTORING || 'mistral-medium-latest',
    analysis: process.env.MODEL_MISTRAL_ANALYSIS || 'mistral-small-latest',
    vision: process.env.MODEL_MISTRAL_VISION || 'pixtral-large-latest',
    general_chat: process.env.MODEL_MISTRAL_GENERAL_CHAT || 'mistral-small-latest'
  },
  nvidia: {
    tutoring: process.env.MODEL_NVIDIA_TUTORING || 'meta/llama-3.3-70b-instruct',
    analysis: process.env.MODEL_NVIDIA_ANALYSIS || 'meta/llama-3.1-8b-instruct',
    vision: process.env.MODEL_NVIDIA_VISION || 'meta/llama-3.2-11b-vision-instruct',
    general_chat: process.env.MODEL_NVIDIA_GENERAL_CHAT || 'meta/llama-3.3-70b-instruct'
  }
};
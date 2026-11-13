import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'GROQ_API_KEY_1',
  'GROQ_API_KEY_2',
  'CF_ACCOUNT_ID',
  'CF_R2_ACCESS_KEY',
  'CF_R2_SECRET_KEY',
  'CF_R2_BUCKET',
  'CF_R2_PUBLIC_URL',
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);

const normalizeApiKey = (name) => {
  const value = process.env[name];
  if (!value) return value;

  const normalized = value.trim().replace(/[\r\n\t]/g, '');
  if (normalized !== value) {
    console.warn(`[ENV] Normalized whitespace in ${name}. Update the Render variable without line breaks.`);
  }
  return normalized;
};

const smtpEmail = process.env.SMTP_EMAIL || process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;

if (!smtpEmail) missingVars.push('SMTP_EMAIL (or SMTP_USER)');
if (!smtpPass) missingVars.push('SMTP_PASSWORD (or SMTP_PASS)');

if (missingVars.length > 0) {
  console.error('Missing required environment variables:');
  console.error(missingVars.join(', '));
  console.error('\nCopy .env.example to .env and fill in all values.');
  process.exit(1);
}

export const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
  
  groq: {
    apiKey: normalizeApiKey('GROQ_API_KEY_1'),
  },
  groqSecondary: {
    apiKey: normalizeApiKey('GROQ_API_KEY_2'),
  },
  mistral: {
    apiKey: normalizeApiKey('MISTRAL_API_KEY'),
  },
  openRouter: {
    apiKey: normalizeApiKey('OPENROUTER_API_KEY'),
  },
  nvidia: {
    apiKey: normalizeApiKey('NVIDIA_API_KEY'),
  },
  cerebras: {
    apiKey: normalizeApiKey('CEREBRAS_API_KEY'),
  },
  gemini: {
    apiKey: normalizeApiKey('GEMINI_API_KEY'),
  },
  
  cfR2: {
    accountId: normalizeApiKey('CF_ACCOUNT_ID'),
    accessKey: normalizeApiKey('CF_R2_ACCESS_KEY'),
    secretKey: normalizeApiKey('CF_R2_SECRET_KEY'),
    bucket: normalizeApiKey('CF_R2_BUCKET'),
    publicUrl: normalizeApiKey('CF_R2_PUBLIC_URL'),
  },
  
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  smtp: {
    email: smtpEmail,
    password: smtpPass,
    from: process.env.SMTP_FROM || `BRAUDLE <${smtpEmail}>`,
  },

  // Optional: YouTube Data API v3 key for real video suggestions in tutoring.
  // If not set, the AI will skip YouTube suggestions gracefully.
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || null,
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || null,
  },
};

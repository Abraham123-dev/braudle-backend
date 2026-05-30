import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'GROQ_API_KEY',
  'HUGGINGFACE_API_KEY',
  'CF_ACCOUNT_ID',
  'CF_R2_ACCESS_KEY',
  'CF_R2_SECRET_KEY',
  'CF_R2_BUCKET',
  'CF_R2_PUBLIC_URL',
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  console.error(missingVars.join(', '));
  console.error('\nCopy .env.example to .env and fill in all values.');
  process.exit(1);
}

export const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
  
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  
  huggingface: {
    apiKey: process.env.HUGGINGFACE_API_KEY,
  },
  
  cfR2: {
    accountId: process.env.CF_ACCOUNT_ID,
    accessKey: process.env.CF_R2_ACCESS_KEY,
    secretKey: process.env.CF_R2_SECRET_KEY,
    bucket: process.env.CF_R2_BUCKET,
    publicUrl: process.env.CF_R2_PUBLIC_URL,
  },
  
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

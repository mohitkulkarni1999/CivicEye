import dotenv from 'dotenv';

dotenv.config();

const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 4000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'civiceye-insecure-default-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoMode: bool(process.env.DEMO_MODE, true),
  aiProvider: process.env.AI_PROVIDER || 'heuristic',
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
  s3AccessKey: process.env.S3_ACCESS_KEY,
  s3SecretKey: process.env.S3_SECRET_KEY,
  s3Region: process.env.S3_REGION,
  nominatimEnabled: bool(process.env.NOMINATIM_ENABLED, true),
  dbLogging: bool(process.env.DB_LOGGING, false),
  rateLimitWindow: int(process.env.RATE_LIMIT_WINDOW, 60000),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 600),
};

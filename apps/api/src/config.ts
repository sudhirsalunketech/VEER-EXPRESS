/** Environment configuration. Secrets come only from process env — never from the frontend. */
export type AppMode = 'demo' | 'development' | 'production';

export interface AppConfig {
  mode: AppMode;
  port: number;
  jwtSecret: string;
  jwtTtl: string;
  databaseUrl?: string;
  corsOrigins: string[];
  /** Branch code that public website bookings belong to (the business has one branch: Kamothe). */
  headBranch: string;
  credentialKey?: string;
  razorpay?: { keyId: string; keySecret: string; webhookSecret: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = (env.APP_MODE ?? 'demo') as AppMode;
  if (!['demo', 'development', 'production'].includes(mode)) throw new Error(`Invalid APP_MODE ${mode}`);
  const jwtSecret = env.JWT_SECRET ?? (mode === 'production' ? '' : 'demo-only-insecure-secret');
  if (mode === 'production') {
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 chars in production');
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (!env.CREDENTIAL_ENCRYPTION_KEY) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production');
  }
  return {
    mode,
    port: Number(env.PORT ?? 3000),
    jwtSecret,
    jwtTtl: env.JWT_TTL ?? '8h',
    databaseUrl: mode === 'demo' ? undefined : env.DATABASE_URL,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    headBranch: env.HEAD_BRANCH_CODE ?? 'BR-KMT',
    credentialKey: env.CREDENTIAL_ENCRYPTION_KEY,
    razorpay: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '' }
      : undefined,
  };
}

export const CONFIG = Symbol('CONFIG');

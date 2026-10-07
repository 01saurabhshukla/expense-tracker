import { z } from 'zod';
import { fileURLToPath } from 'node:url';

const DEFAULT_UPLOAD_DIR = fileURLToPath(new URL('../../storage', import.meta.url));

// "https://app.example.com,http://localhost:5173" → a list of exact origins
// (scheme + host + port, no path, no trailing slash).
const originList = z
  .string()
  .transform((text) => text.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(
    z.array(
      z.url().refine((url) => URL.canParse(url) && new URL(url).origin === url, {
        message: 'must be an origin like https://app.example.com (no path, no trailing slash)',
      }),
    ).min(1),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  // Path to Supabase's CA certificate (Dashboard → Database → SSL
  // Configuration → Download certificate). Required in production (D37).
  DATABASE_CA_CERT: z.string().min(1).optional(),
  // "disable" only for a throwaway local database in CI (no TLS there).
  DATABASE_SSL: z.enum(['require', 'disable']).default('require'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Connections each process may open. Supabase's Session pooler allows 15
  // in total across ALL processes (API + worker): size them to fit.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  UPLOAD_DIR: z.string().min(1).default(DEFAULT_UPLOAD_DIR),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  // Namespaces every BullMQ key in Redis; tests use their own to stay isolated.
  QUEUE_PREFIX: z.string().regex(/^[A-Za-z0-9-]+$/).default('expense'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().min(0).default(2000),
  // Rate limiting (D36). On by default; the test suite turns it off (tests
  // log in far more often than a person) except in its own test file.
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Browser origins allowed to call the API (the frontend). Required in
  // production; in development it defaults to the Vite dev server.
  CORS_ORIGINS: originList.optional(),
  // Which proxy to believe about the client's real IP (X-Forwarded-For):
  // "loopback" = nginx on the same machine (EC2), a number = that many proxy
  // hops, "false" = no proxy (local dev). Never "true": then anyone could
  // fake their IP. Required in production (D35).
  TRUST_PROXY: z
    .string()
    .regex(/^(false|loopback|[1-9])$/, 'must be "false", "loopback" or a number of proxy hops (1-9)')
    .optional(),
}).transform((env, ctx) => {
  const required = (key) => {
    ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
    return z.NEVER;
  };
  if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS) return required('CORS_ORIGINS');
  if (env.NODE_ENV === 'production' && !env.TRUST_PROXY) return required('TRUST_PROXY');
  if (env.NODE_ENV === 'production' && !env.DATABASE_CA_CERT) return required('DATABASE_CA_CERT');
  if (env.NODE_ENV === 'production' && env.DATABASE_SSL !== 'require') {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_SSL'], message: 'must be "require" in production' });
    return z.NEVER;
  }
  return {
    ...env,
    CORS_ORIGINS: env.CORS_ORIGINS ?? ['http://localhost:5173'],
    TRUST_PROXY: parseTrustProxy(env.TRUST_PROXY ?? 'false'),
  };
});

function parseTrustProxy(value) {
  if (value === 'false') return false;
  if (value === 'loopback') return 'loopback';
  return Number(value);
}

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables (check backend/.env):\n${problems}`);
}

export const env = result.data;

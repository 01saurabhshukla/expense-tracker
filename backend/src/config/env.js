import { z } from 'zod';
import { fileURLToPath } from 'node:url';

const DEFAULT_UPLOAD_DIR = fileURLToPath(new URL('../../storage', import.meta.url));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  UPLOAD_DIR: z.string().min(1).default(DEFAULT_UPLOAD_DIR),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables (check backend/.env):\n${problems}`);
}

export const env = result.data;

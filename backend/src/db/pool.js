import pg from 'pg';
import { env } from '../config/env.js';
import { databaseSsl } from './ssl.js';

// bigint (int8) columns — amounts in paise, count(*) — arrive as strings by
// default, because a JS number can't hold every int8 exactly. Ours are far
// below 2^53 (₹90 trillion in paise), so they become numbers. If one ever
// isn't, fail loudly instead of returning a silently rounded amount.
pg.types.setTypeParser(pg.types.builtins.INT8, (text) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error(`int8 value ${text} is too large for a JS number`);
  return value;
});

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: databaseSsl(env.DATABASE_CA_CERT, env.DATABASE_SSL),
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// An idle connection can fail (e.g. the DB restarts). Without this listener
// the error would be unhandled and crash the whole process.
pool.on('error', (err) => {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: 'error',
    message: `Idle database connection error: ${err.message}`,
  }));
});

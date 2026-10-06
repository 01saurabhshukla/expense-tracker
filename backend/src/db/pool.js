import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
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

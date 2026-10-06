import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { log } from '../log.js';

// BullMQ 6 needs a ready-made client when used from ES modules.

// For the API, which only adds jobs: if Redis is down, fail the command fast
// instead of holding it in memory while the user's request waits.
export function createProducerConnection() {
  return watch(new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }), 'producer');
}

// For the worker: BullMQ requires maxRetriesPerRequest: null because it uses
// long-waiting "blocking" commands to wait for new jobs.
export function createWorkerConnection() {
  return watch(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), 'worker');
}

// ioredis reports connection problems as 'error' events and reconnects by
// itself. Logging them keeps them visible instead of "Unhandled error event".
function watch(connection, role) {
  connection.on('error', (err) => log('warn', 'Redis connection error', { role, error: err.message }));
  return connection;
}

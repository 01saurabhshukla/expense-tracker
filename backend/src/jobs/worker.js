import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { createWorkerConnection } from './redis.js';
import { UPLOAD_QUEUE_NAME, enqueueUpload } from './uploadQueue.js';
import { processUpload } from './processUpload.js';
import { findStaleUnfinishedUploadIds } from '../db/queries/uploads.js';
import { log } from '../log.js';

const SWEEP_INTERVAL_MS = 60_000;
// Only uploads untouched for this long are considered lost. Shorter would
// re-add uploads that are about to be processed normally (and, in tests that
// share one database, other test files' uploads).
export const SWEEP_STALE_AFTER_MS = 60_000;

// Starts processing uploads from the queue. Returns { close } for shutdown.
export async function startUploadWorker() {
  const connection = createWorkerConnection();

  const worker = new Worker(
    UPLOAD_QUEUE_NAME,
    async (job) => {
      // attemptsMade = earlier failed attempts (0 on the first run).
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await processUpload(job.data.uploadId, { isFinalAttempt });
    },
    { connection, prefix: env.QUEUE_PREFIX, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    log('warn', 'Upload job failed', {
      uploadId: job?.data.uploadId,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  // Postgres is the source of truth; Redis is only the to-do list. If Redis
  // lost its jobs (restart without persistence) or an enqueue failed while
  // Redis was down, unfinished uploads would sit forever. The sweep re-adds
  // the ones that have been stuck for a while; uploads already queued are
  // untouched because jobId = uploadId.
  await sweepUnfinishedUploads();
  const timer = setInterval(() => {
    sweepUnfinishedUploads().catch((err) => log('error', 'Upload sweep failed', { error: err.message }));
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  log('info', 'Upload worker started', { concurrency: env.WORKER_CONCURRENCY, prefix: env.QUEUE_PREFIX });

  return {
    async close() {
      clearInterval(timer);
      await worker.close(); // waits for running jobs to finish
      await connection.quit();
    },
  };
}

export async function sweepUnfinishedUploads() {
  const ids = await findStaleUnfinishedUploadIds(SWEEP_STALE_AFTER_MS);
  for (const id of ids) await enqueueUpload(id);
  if (ids.length > 0) log('info', 'Swept unfinished uploads into the queue', { count: ids.length });
}

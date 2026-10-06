import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { createProducerConnection } from './redis.js';

export const UPLOAD_QUEUE_NAME = 'upload-processing';

let queue = null;
let connection = null;

// Created on first use, so code that never enqueues (most tests, scripts)
// never opens a Redis connection.
function getQueue() {
  if (!queue) {
    connection = createProducerConnection();
    queue = new Queue(UPLOAD_QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX });
  }
  return queue;
}

export async function enqueueUpload(uploadId) {
  await getQueue().add(
    'process-upload',
    { uploadId },
    {
      // One job per upload: adding the same id again is a no-op, so the
      // sweeper can safely re-add anything that looks stuck.
      jobId: uploadId,
      attempts: env.JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
      // Postgres holds the real history; Redis only keeps recent jobs.
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );
}

export async function closeUploadQueue() {
  if (!queue) return;
  await queue.close();
  await connection.quit(); // we created it, so we close it (BullMQ won't)
  queue = null;
  connection = null;
}

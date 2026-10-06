// Entry point for the background worker process (npm run worker).
// Runs separately from the API: the API accepts uploads, this processes them.
import { startUploadWorker } from './jobs/worker.js';
import { closeUploadQueue } from './jobs/uploadQueue.js';
import { pool } from './db/pool.js';
import { log } from './log.js';

const worker = await startUploadWorker();

// pm2, Ctrl+C and deploys send these. Finish running jobs, then exit cleanly,
// so no upload is left half-processed.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    log('info', 'Worker shutting down', { signal });
    await worker.close();
    await closeUploadQueue();
    await pool.end();
    process.exit(0);
  });
}

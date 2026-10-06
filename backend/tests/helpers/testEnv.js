// Gives a test file its own storage folder and its own BullMQ queue prefix,
// so test files running in parallel never see each other's files or jobs.
// Must be called BEFORE the app is imported: env.js reads these on import.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export async function isolateTestEnv(name, overrides = {}) {
  const uploadDir = await mkdtemp(path.join(tmpdir(), `${name}-`));
  const queuePrefix = `test-${randomUUID()}`;
  Object.assign(process.env, { UPLOAD_DIR: uploadDir, QUEUE_PREFIX: queuePrefix }, overrides);

  return {
    uploadDir,
    queuePrefix,
    // Closes the app's queue connection (else the test process can't exit),
    // deletes this file's Redis keys and its storage folder.
    async cleanup() {
      const { closeUploadQueue } = await import('../../src/jobs/uploadQueue.js');
      await closeUploadQueue();
      await deleteKeysWithPrefix(queuePrefix);
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}

async function deleteKeysWithPrefix(prefix) {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }
}

// Polls GET /uploads/:id like the frontend will, until the upload finishes.
// Returns the final upload and every stage that was seen along the way.
export async function waitForUpload(baseUrl, token, uploadId, { timeoutMs = 20_000 } = {}) {
  const stagesSeen = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/uploads/${uploadId}`, { headers: { authorization: `Bearer ${token}` } });
    const { upload } = await res.json();
    if (stagesSeen.at(-1) !== upload.stage) stagesSeen.push(upload.stage);
    if (upload.stage === 'completed' || upload.stage === 'failed') return { upload, stagesSeen };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Upload ${uploadId} did not finish; stages seen: ${stagesSeen.join(' → ')}`);
}

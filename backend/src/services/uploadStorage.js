import path from 'node:path';
import { mkdir, rename, rm } from 'node:fs/promises';
import { env } from '../config/env.js';

const ROOT = path.resolve(env.UPLOAD_DIR);

// tmp/   files still arriving or not yet checked — never read by the app
// files/ files that passed every check and have an `uploads` row
export const TMP_DIR = path.join(ROOT, 'tmp');
const FILES_DIR = path.join(ROOT, 'files');

// 0o700: only the user running the backend can read these folders.
await mkdir(TMP_DIR, { recursive: true, mode: 0o700 });
await mkdir(FILES_DIR, { recursive: true, mode: 0o700 });

// Same folder tree → rename is atomic: the file is either fully in tmp/ or
// fully in files/, never half-copied. Returns both forms of the path:
// `absolutePath` for this process, `storagePath` (relative to UPLOAD_DIR)
// for the database.
export async function moveToStorage(tempPath, uploadId) {
  const storagePath = path.posix.join('files', uploadId);
  const absolutePath = path.join(ROOT, storagePath);
  await rename(tempPath, absolutePath);
  return { storagePath, absolutePath };
}

// Only for files that never became an accepted upload (aborted, rejected,
// or failed before their DB rows were saved). Accepted files are never deleted.
export async function removeFile(filePath) {
  await rm(filePath, { force: true });
}

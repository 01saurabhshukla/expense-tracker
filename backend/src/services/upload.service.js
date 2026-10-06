import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { withTransaction } from '../db/transaction.js';
import {
  insertUpload,
  insertStoredFile,
  findUploadByHash,
  listUploadsForUser,
  findUploadForUser,
} from '../db/queries/uploads.js';
import { uploadIdSchema } from '../schemas/uploads.js';
import { assertUtf8Text } from './fileChecks.js';
import { assertSafeXlsx } from './xlsxChecks.js';
import { moveToStorage, removeFile } from './uploadStorage.js';

const PG_UNIQUE_VIOLATION = '23505';

// Each format's content check must pass before the file is accepted.
const CONTENT_CHECKS = { csv: assertUtf8Text, xlsx: assertSafeXlsx };

// `received` comes from receiveSingleFile: a temp file that arrived completely
// and within the size limit, but hasn't been checked yet.
export async function createUpload(userId, received) {
  const { tempPath, sizeBytes, sha256, originalFilename, format } = received;
  let absolutePath = null;

  try {
    if (sizeBytes === 0) throw new AppError(400, 'EMPTY_FILE', 'File is empty');
    await CONTENT_CHECKS[format](tempPath);

    // Cheap early answer for the common case. The UNIQUE constraint below
    // still catches two identical uploads racing each other.
    const existing = await findUploadByHash(userId, sha256);
    if (existing) throw duplicate(existing.id);

    const id = randomUUID();
    const stored = await moveToStorage(tempPath, id);
    absolutePath = stored.absolutePath;

    // Both rows or neither: an upload never exists without its file mapping.
    return await withTransaction(async (db) => {
      const upload = await insertUpload(db, { id, userId, originalFilename, sizeBytes, sha256, format });
      await insertStoredFile(db, { uploadId: id, userId, storagePath: stored.storagePath });
      return upload;
    });
  } catch (err) {
    // The upload failed before its rows were saved, so the file was never
    // accepted: remove it from tmp/ or files/. (Accepted files are never deleted.)
    await removeFile(absolutePath ?? tempPath);

    if (err.code === PG_UNIQUE_VIOLATION) {
      const existing = await findUploadByHash(userId, sha256);
      throw duplicate(existing?.id);
    }
    throw err;
  }
}

export async function listUploads(userId, { limit, offset }) {
  // Ask for one extra row: if it comes back, there's another page.
  const rows = await listUploadsForUser(userId, { limit: limit + 1, offset });
  return {
    uploads: rows.slice(0, limit),
    pagination: { limit, offset, hasMore: rows.length > limit },
  };
}

// "Doesn't exist", "not a valid id" and "belongs to someone else" all get the
// same 404, so nobody can probe which upload ids exist.
export async function getUpload(userId, id) {
  // Checked before querying: Postgres would reject a malformed uuid with an
  // error that would otherwise surface as a 500.
  const upload = uploadIdSchema.safeParse(id).success ? await findUploadForUser(userId, id) : null;
  if (!upload) throw new AppError(404, 'UPLOAD_NOT_FOUND', 'Upload not found');
  return upload;
}

// The existing id lets a client that retried after a network drop see that
// its first attempt actually succeeded.
function duplicate(existingUploadId) {
  return new AppError(409, 'DUPLICATE_FILE', 'This file has already been uploaded', {
    existingUploadId,
  });
}

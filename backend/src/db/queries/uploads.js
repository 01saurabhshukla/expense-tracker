import { pool } from '../pool.js';

// Write functions take `db` first: the pool, or a client from withTransaction().

// What every API response shows about an upload. Row errors are left out of
// lists (they can be long) and added only for a single upload.
const PUBLIC_COLUMNS = `
  id, original_filename AS "originalFilename", size_bytes AS "sizeBytes",
  format, stage, progress,
  CASE WHEN error_code IS NULL THEN NULL
       ELSE json_build_object('code', error_code, 'message', error_message) END AS error,
  created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"`;

export async function insertUpload(db, { id, userId, originalFilename, sizeBytes, sha256, format }) {
  const { rows } = await db.query(
    `INSERT INTO uploads (id, user_id, original_filename, size_bytes, sha256, format)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, userId, originalFilename, sizeBytes, sha256, format],
  );
  return rows[0];
}

export async function insertStoredFile(db, { uploadId, userId, storagePath }) {
  await db.query(
    `INSERT INTO stored_files (upload_id, user_id, storage_path)
     VALUES ($1, $2, $3)`,
    [uploadId, userId, storagePath],
  );
}

// Every read filters by user_id: a user can only ever see their own uploads.
// `id DESC` breaks ties between uploads created in the same instant, so the
// order is stable and pages never repeat or skip a row.
export async function listUploadsForUser(userId, { limit, offset }) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM uploads
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows;
}

export async function findUploadForUser(userId, id) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS}, row_errors AS "rowErrors"
     FROM uploads WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function findUploadByHash(userId, sha256) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM uploads WHERE user_id = $1 AND sha256 = $2`,
    [userId, sha256],
  );
  return rows[0] ?? null;
}

// ---------- used by the background worker ----------

// Claims an upload for processing: resets the previous attempt's results and
// moves it to 'reading'. Returns nothing if it's already finished (a stray
// duplicate job), so finished uploads are never processed twice.
export async function startProcessing(uploadId) {
  const { rows } = await pool.query(
    `UPDATE uploads u
     SET stage = 'reading', progress = '{}'::jsonb, row_errors = '[]'::jsonb,
         error_code = NULL, error_message = NULL,
         attempts = attempts + 1, started_at = now(), finished_at = NULL, updated_at = now()
     FROM stored_files sf
     WHERE u.id = $1 AND sf.upload_id = u.id AND u.stage NOT IN ('completed', 'failed')
     RETURNING u.id, u.user_id AS "userId", u.format, sf.storage_path AS "storagePath"`,
    [uploadId],
  );
  return rows[0] ?? null;
}

// `progress` is merged into what's there (jsonb ||), so callers send only
// the counters that changed.
export async function updateStage(db, uploadId, stage, progress = {}) {
  await db.query(
    `UPDATE uploads SET stage = $2, progress = progress || $3::jsonb, updated_at = now()
     WHERE id = $1`,
    [uploadId, stage, JSON.stringify(progress)],
  );
}

export async function markCompleted(db, uploadId, { progress, rowErrors }) {
  await db.query(
    `UPDATE uploads
     SET stage = 'completed', progress = progress || $2::jsonb, row_errors = $3::jsonb,
         finished_at = now(), updated_at = now()
     WHERE id = $1`,
    [uploadId, JSON.stringify(progress), JSON.stringify(rowErrors)],
  );
}

export async function markFailed(uploadId, { code, message, rowErrors = [] }) {
  await pool.query(
    `UPDATE uploads
     SET stage = 'failed', error_code = $2, error_message = $3, row_errors = $4::jsonb,
         finished_at = now(), updated_at = now()
     WHERE id = $1`,
    [uploadId, code, message, JSON.stringify(rowErrors)],
  );
}

// Uploads that should be in the queue: anything not finished.
export async function findUnfinishedUploadIds() {
  const { rows } = await pool.query(
    `SELECT id FROM uploads WHERE stage NOT IN ('completed', 'failed') ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}

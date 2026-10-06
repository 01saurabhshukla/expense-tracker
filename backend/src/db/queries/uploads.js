import { pool } from '../pool.js';

// Write functions take `db` first: the pool, or a client from withTransaction().

const PUBLIC_COLUMNS = `
  id, original_filename AS "originalFilename", size_bytes AS "sizeBytes",
  format, status, created_at AS "createdAt"`;

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
    `SELECT ${PUBLIC_COLUMNS} FROM uploads WHERE id = $1 AND user_id = $2`,
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

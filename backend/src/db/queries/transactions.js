import { pool } from '../pool.js';

// Write functions take `db` first: the pool, or a client from withTransaction().

// One INSERT per this many rows: big enough to be fast, small enough that a
// single statement stays reasonably sized.
const BATCH_SIZE = 1000;

export async function deleteTransactionsForUpload(db, uploadId) {
  await db.query('DELETE FROM transactions WHERE upload_id = $1', [uploadId]);
}

// Inserts many rows with one statement per batch. unnest() turns parallel
// arrays (all dates, all descriptions, ...) back into rows inside Postgres,
// so 1000 rows cost one round trip instead of 1000.
//
// A row whose fingerprint this user already has (from an overlapping
// statement) is skipped by ON CONFLICT DO NOTHING; the returned count is only
// the rows actually inserted.
export async function insertTransactions(db, { userId, uploadId, transactions }) {
  let inserted = 0;
  for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
    const batch = transactions.slice(start, start + BATCH_SIZE);
    const column = (key) => batch.map((t) => t[key]);

    const { rowCount } = await db.query(
      `INSERT INTO transactions
         (user_id, upload_id, line, date, value_date, description, reference,
          direction, amount_paise, balance_paise, fingerprint,
          category, category_source, merchant_key)
       SELECT $1, $2, * FROM unnest(
         $3::int[], $4::date[], $5::date[], $6::text[], $7::text[],
         $8::text[], $9::bigint[], $10::bigint[], $11::text[],
         $12::text[], $13::text[], $14::text[])
       ON CONFLICT (user_id, fingerprint) DO NOTHING`,
      [
        userId,
        uploadId,
        column('line'),
        column('date'),
        column('valueDate'),
        column('description'),
        column('reference'),
        column('direction'),
        column('amountPaise'),
        column('balancePaise'),
        column('fingerprint'),
        column('category'),
        column('categorySource'),
        column('merchantKey'),
      ],
    );
    inserted += rowCount;
  }
  return inserted;
}

// ---------- reading (the API) ----------

// What the API shows about a transaction. The fingerprint is internal.
// Dates as text: a statement date has no time zone, and a JS Date would add one.
const PUBLIC_COLUMNS = `
  id, upload_id AS "uploadId", line, date::text AS date, value_date::text AS "valueDate",
  description, reference, direction, amount_paise AS "amountPaise",
  balance_paise AS "balancePaise", category, category_source AS "categorySource",
  merchant_key AS "merchantKey"`;

const ORDER_BY = {
  date_desc: 'date DESC, line DESC, id',
  date_asc: 'date ASC, line ASC, id',
  amount_desc: 'amount_paise DESC, date DESC, id',
  amount_asc: 'amount_paise ASC, date DESC, id',
};

// Builds "WHERE user_id = $1 AND …" from the shared filters (schemas/
// transactions.js). Every value is a parameter, never pasted into the SQL.
// `alias` prefixes the columns when the query joins other tables.
export function filterSql(userId, filters, alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const params = [userId];
  const where = [`${col('user_id')} = $1`];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.from) add(`${col('date')} >= ?`, filters.from);
  if (filters.to) add(`${col('date')} <= ?`, filters.to);
  if (filters.category) add(`${col('category')} = ?`, filters.category);
  if (filters.direction) add(`${col('direction')} = ?`, filters.direction);
  if (filters.uploadId) add(`${col('upload_id')} = ?`, filters.uploadId);
  // % and _ are wildcards in LIKE; escape them so "50%" means the text "50%".
  if (filters.q) add(`${col('description')} ILIKE ? ESCAPE '\\'`, `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);

  return { where: where.join(' AND '), params };
}

export async function listTransactionsForUser(userId, filters, { sort, limit, offset }) {
  const { where, params } = filterSql(userId, filters);
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM transactions
     WHERE ${where}
     ORDER BY ${ORDER_BY[sort]}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows;
}

// Keyset pages for exports: "the next `limit` rows after this one", in date
// order. Unlike OFFSET, every page costs the same however deep it is.
export async function listTransactionsAfter(userId, filters, after, limit) {
  const { where, params } = filterSql(userId, filters);
  const keyset = after ? `AND (date, line, id) > ($${params.length + 1}::date, $${params.length + 2}::int, $${params.length + 3}::uuid)` : '';
  const keysetParams = after ? [after.date, after.line, after.id] : [];
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM transactions
     WHERE ${where} ${keyset}
     ORDER BY date, line, id
     LIMIT $${params.length + keysetParams.length + 1}`,
    [...params, ...keysetParams, limit],
  );
  return rows;
}

export async function findTransactionForUser(db, userId, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM transactions WHERE id = $1 AND user_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id, userId],
  );
  return rows[0] ?? null;
}

// ---------- corrections ----------

export async function setTransactionCategory(db, userId, id, category) {
  const { rows } = await db.query(
    `UPDATE transactions SET category = $3, category_source = 'user'
     WHERE id = $1 AND user_id = $2
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, userId, category],
  );
  return rows[0];
}

// Every transaction of this user from this merchant gets the category.
export async function setMerchantCategory(db, userId, merchantKey, category) {
  const { rowCount } = await db.query(
    `UPDATE transactions SET category = $3, category_source = 'user'
     WHERE user_id = $1 AND merchant_key = $2`,
    [userId, merchantKey, category],
  );
  return rowCount;
}

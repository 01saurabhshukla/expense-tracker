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
export async function insertTransactions(db, { userId, uploadId, transactions }) {
  let inserted = 0;
  for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
    const batch = transactions.slice(start, start + BATCH_SIZE);
    const column = (key) => batch.map((t) => t[key]);

    const { rowCount } = await db.query(
      `INSERT INTO transactions
         (user_id, upload_id, line, date, value_date, description, reference,
          direction, amount_paise, balance_paise)
       SELECT $1, $2, * FROM unnest(
         $3::int[], $4::date[], $5::date[], $6::text[], $7::text[],
         $8::text[], $9::bigint[], $10::bigint[])`,
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
      ],
    );
    inserted += rowCount;
  }
  return inserted;
}

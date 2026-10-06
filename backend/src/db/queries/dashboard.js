import { pool } from '../pool.js';
import { filterSql } from './transactions.js';

// Aggregates for the dashboard. All of them use the same filters as the
// transaction list (filterSql), so a chart and the list behind it agree.
//
// sum() of bigint returns numeric, which pg hands over as a string; the
// ::bigint casts make it int8, which pool.js turns into a checked number.
const SUMS = `
  count(*) AS count,
  coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)::bigint AS "debitPaise",
  coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)::bigint AS "creditPaise"`;

export async function totalsForUser(userId, filters) {
  const { where, params } = filterSql(userId, filters);
  const { rows } = await pool.query(
    `SELECT ${SUMS}, min(date)::text AS "from", max(date)::text AS "to"
     FROM transactions WHERE ${where}`,
    params,
  );
  return rows[0];
}

export async function byCategoryForUser(userId, filters) {
  const { where, params } = filterSql(userId, filters);
  const { rows } = await pool.query(
    `SELECT category, ${SUMS} FROM transactions WHERE ${where} GROUP BY category`,
    params,
  );
  return rows;
}

// One row per (period, category). `period` is the first day of the day /
// week (Monday) / month, as YYYY-MM-DD.
export async function timelineForUser(userId, filters, granularity) {
  const { where, params } = filterSql(userId, filters);
  const { rows } = await pool.query(
    `SELECT date_trunc($${params.length + 1}, date)::date::text AS period, category, ${SUMS}
     FROM transactions WHERE ${where}
     GROUP BY 1, 2 ORDER BY 1`,
    [...params, granularity],
  );
  return rows;
}

// Where the money goes: merchants by money out.
export async function topMerchantsForUser(userId, filters, limit) {
  const { where, params } = filterSql(userId, filters);
  const { rows } = await pool.query(
    `SELECT merchant_key AS "merchantKey", count(*) AS count,
            sum(amount_paise)::bigint AS "debitPaise",
            mode() WITHIN GROUP (ORDER BY category) AS category
     FROM transactions
     WHERE ${where} AND direction = 'debit' AND merchant_key IS NOT NULL
     GROUP BY merchant_key
     ORDER BY "debitPaise" DESC, merchant_key
     LIMIT $${params.length + 1}`,
    [...params, limit],
  );
  return rows;
}

import { pipeline } from 'node:stream/promises';
import { CATEGORIES } from '../categorize/categories.js';
import { listTransactionsAfter } from '../db/queries/transactions.js';
import { getDashboard } from './dashboard.service.js';
import { writeTransactionsCsv } from '../export/transactionsCsv.js';
import { buildReport } from '../export/pdfReport.js';
import { formatDate } from '../export/format.js';

// The PDF lists at most this many transactions (the CSV has them all).
export const PDF_MAX_TRANSACTIONS = 500;

export async function exportCsv(userId, filters, res) {
  startDownload(res, 'text/csv; charset=utf-8', `transactions-${today()}.csv`);
  await writeTransactionsCsv(userId, filters, res);
}

export async function exportPdf(userId, filters, res) {
  // Gather everything first: if a query fails, the user gets a normal JSON
  // error instead of half a PDF.
  const [dashboard, firstRows] = await Promise.all([
    getDashboard(userId, { ...filters, granularity: 'month' }),
    listTransactionsAfter(userId, filters, null, PDF_MAX_TRANSACTIONS + 1),
  ]);
  const doc = buildReport({
    dashboard,
    transactions: firstRows.slice(0, PDF_MAX_TRANSACTIONS),
    moreTransactions: firstRows.length > PDF_MAX_TRANSACTIONS,
    filtersText: describeFilters(filters),
    generatedAt: new Date(),
  });
  startDownload(res, 'application/pdf', `expense-report-${today()}.pdf`);
  await pipeline(doc, res);
}

function startDownload(res, contentType, filename) {
  res.status(200);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    // Financial data: never stored by the browser or a proxy cache.
    'Cache-Control': 'no-store',
  });
}

// "category: Food & Dining, from 01/09/2026" — printed on the report so a
// filtered report can't be mistaken for a full one.
function describeFilters({ from, to, category, direction, uploadId, q }) {
  const parts = [];
  if (from) parts.push(`from ${formatDate(from)}`);
  if (to) parts.push(`to ${formatDate(to)}`);
  if (category) parts.push(`category: ${CATEGORIES.find((c) => c.key === category)?.name}`);
  if (direction) parts.push(direction === 'debit' ? 'money out only' : 'money in only');
  if (uploadId) parts.push('one statement only');
  if (q) parts.push(`description contains "${q}"`);
  return parts.join(', ');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

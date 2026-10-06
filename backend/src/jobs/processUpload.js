import { UnrecoverableError } from 'bullmq';
import { withTransaction } from '../db/transaction.js';
import {
  startProcessing,
  updateStage,
  markCompleted,
  markFailed,
} from '../db/queries/uploads.js';
import { deleteTransactionsForUpload, insertTransactions } from '../db/queries/transactions.js';
import { pool } from '../db/pool.js';
import { readCsvRows } from '../parsing/readers/csvReader.js';
import { readXlsxRows } from '../parsing/readers/xlsxReader.js';
import { findHeader, MAX_ROWS_BEFORE_HEADER } from '../parsing/columns.js';
import { normalizeRow, noValidTransactions } from '../parsing/normalize.js';
import { ParseError } from '../parsing/errors.js';
import { createFingerprinter } from '../parsing/fingerprint.js';
import { categorizeTransactions } from '../categorize/categorize.js';
import { findOverridesForUser } from '../db/queries/categoryOverrides.js';
import { createSummary } from '../summary/summarize.js';
import { resolveStoredFile } from '../services/uploadStorage.js';
import { log } from '../log.js';

// How many row errors are kept on the upload; the total is in progress.rowErrors.
const MAX_STORED_ROW_ERRORS = 100;
// Valid rows are categorized and inserted this many at a time (one INSERT).
export const IMPORT_BATCH_SIZE = 5000;
// The progress the frontend polls is written at most this often.
const PROGRESS_EVERY_MS = 500;

// Runs one upload through:
//   queued → reading → importing → saving → completed   (or failed)
//
//   reading    find the header row
//   importing  ONE streaming pass over the rest of the file: check each row,
//              categorize, fingerprint, summarize and insert, a batch at a
//              time. Memory stays flat however big the file is (7i).
//   saving     commit, and write the summary
//
// Safe to run again for the same upload (retries, restarts): it starts by
// resetting the upload, and everything is written in ONE database
// transaction that first removes any rows from an earlier attempt. A file
// that fails halfway (e.g. a broken quote on line 150,000) leaves nothing.
//
// `isFinalAttempt` decides what an unexpected error does: retry later, or
// mark the upload failed for good.
export async function processUpload(uploadId, { isFinalAttempt = true } = {}) {
  const upload = await startProcessing(uploadId);
  if (!upload) return; // deleted, or already finished by an earlier job

  try {
    await importStatement(upload);
  } catch (err) {
    if (err instanceof ParseError) {
      // The file's content is the problem: retrying can't help.
      await markFailed(uploadId, {
        code: err.code,
        message: err.message,
        rowErrors: (err.details?.errors ?? []).slice(0, MAX_STORED_ROW_ERRORS),
      });
      throw new UnrecoverableError(err.code);
    }

    // Our problem (database hiccup, bug, missing file): log the details,
    // never show them to the user.
    log('error', 'Upload processing failed', {
      uploadId,
      isFinalAttempt,
      error: err.message,
      stack: err.stack,
    });
    if (isFinalAttempt) {
      await markFailed(uploadId, {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong while processing this file. Please try again later.',
      });
    } else {
      await updateStage(pool, uploadId, 'queued'); // BullMQ will retry after a delay
    }
    throw err;
  }
}

async function importStatement(upload) {
  // How far through the file the reader is (0–1), for the progress bar.
  let fraction = 0;
  const readRows = upload.format === 'xlsx' ? readXlsxRows : readCsvRows;
  const rows = readRows(resolveStoredFile(upload.storagePath), { onProgress: (f) => (fraction = f) });

  // Stage "reading": pull the first rows to find the header. `rows` is a
  // generator, so pulling with next() and then continuing with `yield* rows`
  // later picks up exactly where we stopped — nothing is read twice.
  const firstRows = [];
  while (firstRows.length < MAX_ROWS_BEFORE_HEADER) {
    const { value, done } = await rows.next();
    if (done) break;
    firstRows.push(value);
  }
  const header = findHeader(firstRows);
  async function* dataRows() {
    yield* firstRows.slice(header.index + 1);
    yield* rows;
  }

  // Stage "importing".
  await updateStage(pool, upload.id, 'importing', { percent: 0 });
  const overrides = await findOverridesForUser(upload.userId);
  const fingerprint = createFingerprinter();
  const summary = createSummary();
  const counts = {
    rowsRead: 0,
    transactionsFound: 0,
    transactionsSaved: 0,
    rowErrors: 0,
    skippedRows: 0,
    categorizedBy: { user: 0, rule: 0, none: 0 },
  };
  const rowErrors = []; // only the first MAX_STORED_ROW_ERRORS; the total is counted
  let lastProgressAt = Date.now();

  await withTransaction(async (db) => {
    await deleteTransactionsForUpload(db, upload.id);

    let batch = [];
    // Categorize → summarize → fingerprint → insert one batch, then let it go.
    const flush = async () => {
      if (batch.length === 0) return;
      const { transactions, counts: by } = categorizeTransactions(batch, overrides);
      for (const source of Object.keys(by)) counts.categorizedBy[source] += by[source];
      for (const t of transactions) {
        summary.add(t);
        t.fingerprint = fingerprint(t);
      }
      counts.transactionsSaved += await insertTransactions(db, {
        userId: upload.userId,
        uploadId: upload.id,
        transactions,
      });
      batch = [];
    };

    for await (const row of dataRows()) {
      counts.rowsRead++;
      const result = normalizeRow(row, header);
      if (result.kind === 'transaction') {
        counts.transactionsFound++;
        batch.push(result.transaction);
        if (batch.length === IMPORT_BATCH_SIZE) await flush();
      } else if (result.kind === 'error') {
        counts.rowErrors++;
        if (rowErrors.length < MAX_STORED_ROW_ERRORS) rowErrors.push(result.error);
      } else {
        counts.skippedRows++;
      }

      // Progress goes through the pool (its own connection), so the user sees
      // it right away even though this transaction isn't committed yet.
      if (Date.now() - lastProgressAt >= PROGRESS_EVERY_MS) {
        lastProgressAt = Date.now();
        await updateStage(pool, upload.id, 'importing', { ...progressNow(counts), percent: Math.floor(fraction * 100) });
      }
    }
    await flush();

    // Nothing readable at all: the whole file fails (and the transaction
    // rolls back, though there is nothing to undo).
    if (counts.transactionsFound === 0) throw noValidTransactions(counts.rowErrors, rowErrors);

    // Stage "saving": the summary, and "completed" — committed together with
    // every row, so the user never sees a half-saved statement.
    await updateStage(pool, upload.id, 'saving', { ...progressNow(counts), percent: 100 });
    const finalSummary = summary.result();
    if (finalSummary.balance.status === 'mismatch') {
      log('warn', 'Running balance does not add up', {
        uploadId: upload.id,
        mismatchCount: finalSummary.balance.mismatchCount,
        firstLine: finalSummary.balance.mismatches[0].line,
      });
    }
    await markCompleted(db, upload.id, {
      progress: {
        ...counts,
        // Already imported from an overlapping statement (see fingerprint.js).
        duplicatesSkipped: counts.transactionsFound - counts.transactionsSaved,
        percent: 100,
      },
      rowErrors,
      summary: finalSummary,
    });
  });
}

// What the frontend sees while importing. `transactionsSaved` counts rows
// written so far; they become visible to the rest of the app at commit.
function progressNow(counts) {
  const { rowsRead, transactionsFound, transactionsSaved, rowErrors } = counts;
  return { rowsRead, transactionsFound, transactionsSaved, rowErrors };
}

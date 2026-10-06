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
import { findHeader, MAX_ROWS_BEFORE_HEADER } from '../parsing/columns.js';
import { normalizeRows } from '../parsing/normalize.js';
import { ParseError } from '../parsing/errors.js';
import { resolveStoredFile } from '../services/uploadStorage.js';
import { log } from '../log.js';

// How many row errors are kept on the upload; the total is in progress.rowErrors.
const MAX_STORED_ROW_ERRORS = 100;

// Runs one upload through: reading → validating → saving → completed.
// Safe to run again for the same upload (retries, restarts): it starts by
// resetting the upload, and saving replaces any rows from an earlier attempt.
//
// `isFinalAttempt` decides what an unexpected error does: retry later, or
// mark the upload failed for good.
export async function processUpload(uploadId, { isFinalAttempt = true } = {}) {
  const upload = await startProcessing(uploadId);
  if (!upload) return; // deleted, or already finished by an earlier job

  try {
    const result = await parseFile(upload);
    await save(upload, result);
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

async function parseFile(upload) {
  if (upload.format !== 'csv') {
    throw new ParseError('FORMAT_NOT_SUPPORTED_YET', 'Excel (.xlsx) statements can be uploaded but not read yet.');
  }

  const rows = readCsvRows(resolveStoredFile(upload.storagePath));

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

  // Stage "validating": the rest of the file streams through the checks.
  await updateStage(pool, upload.id, 'validating');
  async function* dataRows() {
    yield* firstRows.slice(header.index + 1);
    yield* rows;
  }
  return normalizeRows(dataRows(), header, {
    onProgress: (progress) => updateStage(pool, upload.id, 'validating', progress),
  });
}

// Stage "saving": replace this upload's rows and mark it completed in ONE
// database transaction, so the user never sees a half-saved statement or a
// "completed" upload with missing rows.
async function save(upload, { transactions, errors, skipped }) {
  await updateStage(pool, upload.id, 'saving', {
    transactionsFound: transactions.length,
    rowErrors: errors.length,
    skippedRows: skipped,
  });

  await withTransaction(async (db) => {
    await deleteTransactionsForUpload(db, upload.id);
    const saved = await insertTransactions(db, {
      userId: upload.userId,
      uploadId: upload.id,
      transactions,
    });
    await markCompleted(db, upload.id, {
      progress: {
        rowsRead: transactions.length + errors.length + skipped,
        transactionsFound: transactions.length,
        transactionsSaved: saved,
        rowErrors: errors.length,
        skippedRows: skipped,
      },
      rowErrors: errors.slice(0, MAX_STORED_ROW_ERRORS),
    });
  });
}

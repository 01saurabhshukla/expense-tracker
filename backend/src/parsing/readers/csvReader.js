import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { ParseError } from '../errors.js';

// A single cell bigger than this is not a bank statement field.
const MAX_RECORD_BYTES = 64 * 1024;

// Stage "reading": turns a CSV file into rows of raw strings, one row at a
// time, so even a huge file never sits in memory all at once.
//
// Yields { line, cells } where `line` is the row's line number in the file
// (for error messages) and `cells` is an array of untouched strings.
//
// It deliberately does NOT judge the content: preamble lines, short rows,
// extra columns and footers all come through as-is. Deciding what they mean
// is the next stage's job. The only thing it rejects is text that isn't
// valid CSV at all, like a quote that is never closed.
export async function* readCsvRows(filePath) {
  const parser = parse({
    bom: true, // drop the invisible UTF-8 marker Excel puts at the start
    relax_column_count: true, // rows may have different numbers of cells
    // A stray " inside an unquoted cell (e.g. ABC"S STORE) is kept as a
    // character instead of failing the whole file.
    relax_quotes: true,
    skip_empty_lines: true, // truly empty lines only; ",,,," still comes through
    info: true, // gives us each row's line number
    max_record_size: MAX_RECORD_BYTES,
  });

  // .pipe() does NOT pass errors along: if the file can't be read (missing,
  // permissions, disk error) the parser would wait for data forever and the
  // loop below would never end. Forward the error so the loop throws instead.
  const source = createReadStream(filePath);
  source.on('error', (err) => parser.destroy(err));
  source.pipe(parser);

  try {
    for await (const { record, info } of parser) {
      yield { line: info.lines, cells: record };
    }
  } catch (err) {
    throw toParseError(err);
  }
}

function toParseError(err) {
  // csv-parse errors carry a code like CSV_QUOTE_NOT_CLOSED and a line number.
  if (typeof err.code === 'string' && err.code.startsWith('CSV_')) {
    const reason =
      err.code === 'CSV_QUOTE_NOT_CLOSED'
        ? 'a quoted value is never closed'
        : err.code === 'CSV_MAX_RECORD_SIZE'
          ? 'a row is unreasonably large'
          : 'the file is not valid CSV';
    return new ParseError('MALFORMED_CSV', `Could not read the file: ${reason} (near line ${err.lines}).`, {
      line: err.lines,
    });
  }
  return err; // e.g. a disk error: not the file's fault, so not a ParseError
}

import path from 'node:path';
import yauzl from 'yauzl';
import sax from 'sax';
import { ParseError } from '../errors.js';

// Stage "reading" for .xlsx: turns the first visible worksheet into the SAME
// rows the CSV reader produces — { line, cells } with cells as strings — so
// header detection, normalizing, categorizing and the summary are reused
// unchanged.
//
// The file already passed the upload gate (xlsxChecks.js: real zip, no zip
// bomb, sizes honest), so this only has to understand the content.
//
// An .xlsx is a zip of XML files. The ones we read:
//   xl/workbook.xml             the list of sheets (and the 1904 date flag)
//   xl/_rels/workbook.xml.rels  which file inside the zip each sheet is
//   xl/sharedStrings.xml        text cells point here by number
//   xl/styles.xml               tells us which number cells are dates
//   xl/worksheets/sheetN.xml    the rows themselves (streamed)

// Same limit as a CSV row (csvReader.js): one cell bigger than this is not a
// bank statement field.
const MAX_CELL_CHARS = 64 * 1024;
// A statement has ~10 columns. A value far to the right means something odd
// (and a huge column number would make a huge array).
const MAX_COLUMNS = 200;

const malformed = (reason) =>
  new ParseError('MALFORMED_XLSX', `Could not read the workbook: ${reason}.`);

export async function* readXlsxRows(filePath) {
  let zip;
  try {
    // autoClose: false — we jump between entries, so we close it ourselves.
    zip = await yauzl.openPromise(filePath, { autoClose: false, strictFileNames: true, validateEntrySizes: true });
    const entries = await listEntries(zip);

    const { sheetPath, date1904 } = await readWorkbook(zip, entries);
    const sharedStrings = await readSharedStrings(zip, entries);
    const dateStyles = await readDateStyles(zip, entries);

    yield* readSheetRows(zip, entries.get(sheetPath), { sharedStrings, dateStyles, date1904 });
  } catch (err) {
    throw toParseError(err);
  } finally {
    if (zip?.isOpen) zip.close();
  }
}

// ---------- the workbook: which sheet, which date system ----------

async function listEntries(zip) {
  const entries = new Map();
  for await (const entry of zip.eachEntry()) entries.set(entry.fileName, entry);
  return entries;
}

async function readWorkbook(zip, entries) {
  let date1904 = false;
  const sheets = []; // { relId, hidden } in workbook order
  await parseEntry(zip, required(entries, 'xl/workbook.xml'), {
    open(name, attrs) {
      if (name === 'workbookPr') date1904 = attrs.date1904 === '1' || attrs.date1904 === 'true';
      if (name === 'sheet') {
        sheets.push({ relId: attrByLocalName(attrs, 'id'), hidden: attrs.state === 'hidden' || attrs.state === 'veryHidden' });
      }
    },
  });

  // Relationship id → file path, for worksheets only (chart sheets have no rows).
  const worksheetPaths = new Map();
  await parseEntry(zip, required(entries, 'xl/_rels/workbook.xml.rels'), {
    open(name, attrs) {
      if (name === 'Relationship' && attrs.Type?.endsWith('/worksheet')) {
        worksheetPaths.set(attrs.Id, resolveTarget(attrs.Target));
      }
    },
  });

  const first = sheets.find((sheet) => !sheet.hidden && worksheetPaths.has(sheet.relId));
  if (!first) throw new ParseError('NO_WORKSHEET', 'The workbook has no visible worksheet.');
  const sheetPath = worksheetPaths.get(first.relId);
  required(entries, sheetPath);
  return { sheetPath, date1904 };
}

// "worksheets/sheet1.xml" is relative to xl/; "/xl/worksheets/sheet1.xml" is
// from the zip root. Either way, it must stay inside the zip.
function resolveTarget(target = '') {
  const resolved = target.startsWith('/')
    ? path.posix.normalize(target.slice(1))
    : path.posix.join('xl', target);
  if (resolved.startsWith('..')) throw malformed('a sheet points outside the workbook');
  return resolved;
}

// ---------- shared strings: text cells store a number pointing here ----------

async function readSharedStrings(zip, entries) {
  const entry = entries.get('xl/sharedStrings.xml');
  if (!entry) return []; // a workbook with no text cells has none

  const strings = [];
  let current = null; // text of the <si> being read
  let inText = false;
  let inPhonetic = 0; // <rPh>: pronunciation hints (Japanese), not cell text

  await parseEntry(zip, entry, {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 'rPh') inPhonetic++;
      else if (name === 't' && current !== null && !inPhonetic) inText = true;
    },
    text(text) {
      if (inText) current = appendCapped(current, text);
    },
    close(name) {
      if (name === 't') inText = false;
      else if (name === 'rPh') inPhonetic--;
      else if (name === 'si') {
        strings.push(current);
        current = null;
      }
    },
  });
  return strings;
}

// ---------- styles: is this number a date? ----------

// Excel stores a date as a plain number (days since 1900) and only its
// number format says "show this as a date". Built-in format ids that are dates:
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);

async function readDateStyles(zip, entries) {
  const entry = entries.get('xl/styles.xml');
  if (!entry) return new Set();

  const customDateFormats = new Set();
  const dateStyles = new Set(); // indexes into <cellXfs>, as used by <c s="…">
  let inCellXfs = false;
  let xfIndex = 0;

  await parseEntry(zip, entry, {
    open(name, attrs) {
      if (name === 'numFmt' && isDateFormatCode(attrs.formatCode)) customDateFormats.add(Number(attrs.numFmtId));
      else if (name === 'cellXfs') inCellXfs = true;
      // <xf> also appears in <cellStyleXfs>; only <cellXfs> numbers the cell styles.
      else if (name === 'xf' && inCellXfs) {
        const id = Number(attrs.numFmtId ?? 0);
        if (BUILT_IN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(xfIndex);
        xfIndex++;
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return dateStyles;
}

// "dd/mm/yyyy", "d-mmm-yy" → date. "0.00", "#,##0" → not. Quoted text,
// [colour]/[locale] sections and escaped characters are ignored first. Only d
// and y count: m alone could be minutes.
function isDateFormatCode(code = '') {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dy]/i.test(stripped);
}

// ---------- the sheet itself, streamed row by row ----------

async function* readSheetRows(zip, entry, { sharedStrings, dateStyles, date1904 }) {
  const ready = []; // rows completed by the last chunk, waiting to be yielded
  let row = null; // { line, cells }
  let lastLine = 0;
  let cell = null; // { column, type, style, value, inline }
  let capture = null; // 'v' | 't' — which element's text we're collecting

  const handlers = {
    open(name, attrs) {
      if (name === 'row') {
        const line = attrs.r ? Number(attrs.r) : lastLine + 1;
        // Rows must go down the sheet; otherwise line numbers would lie.
        if (!Number.isInteger(line) || line <= lastLine) throw malformed('rows are out of order');
        row = { line, cells: [] };
      } else if (name === 'c' && row) {
        const column = attrs.r ? columnIndex(attrs.r) : row.cells.length;
        cell = { column, type: attrs.t ?? 'n', style: Number(attrs.s ?? 0), value: '', inline: '' };
      } else if (cell && name === 'v') {
        capture = 'v';
      } else if (cell && name === 't') {
        capture = 't'; // inline string: <c t="inlineStr"><is><t>…</t></is></c>
      }
    },
    text(text) {
      if (capture === 'v') cell.value = appendCapped(cell.value, text);
      else if (capture === 't') cell.inline = appendCapped(cell.inline, text);
    },
    close(name) {
      if (name === 'v' || name === 't') capture = null;
      else if (name === 'c' && cell) {
        const text = cellText(cell, { sharedStrings, dateStyles, date1904 });
        if (text !== '') {
          if (cell.column >= MAX_COLUMNS) throw malformed(`a value is beyond column ${MAX_COLUMNS}`);
          row.cells[cell.column] = text;
        }
        cell = null;
      } else if (name === 'row' && row) {
        lastLine = row.line;
        // Like the CSV reader's skip_empty_lines: a row with no values at all
        // isn't passed on. Gaps between values become empty strings.
        if (row.cells.length > 0) ready.push({ line: row.line, cells: Array.from(row.cells, (c) => c ?? '') });
        row = null;
      }
    },
  };

  for await (const _ of parseEntry(zip, entry, handlers, { streaming: true })) {
    yield* ready.splice(0); // hand over this chunk's rows, then keep reading
  }
  yield* ready.splice(0);
}

// One cell → the string a CSV export would have shown.
function cellText(cell, { sharedStrings, dateStyles, date1904 }) {
  switch (cell.type) {
    case 's': { // shared string
      const text = sharedStrings[Number(cell.value)];
      if (text === undefined) throw malformed('a cell points to a missing shared string');
      return text;
    }
    case 'inlineStr':
      return cell.inline;
    case 'str': // the text result of a formula
    case 'e': // an error like #N/A: kept as text, the row checks will reject it
      return cell.value;
    case 'b':
      return cell.value === '1' ? 'TRUE' : 'FALSE';
    case 'd': // ISO date written as text (rare)
      return isoToDayFirst(cell.value.slice(0, 10)) ?? cell.value;
    default: { // 'n': a number, maybe a date in disguise
      if (cell.value === '') return '';
      const number = Number(cell.value);
      if (!Number.isFinite(number)) return cell.value;
      if (dateStyles.has(cell.style)) return serialToDayFirst(number, date1904) ?? cell.value;
      return formatNumber(number);
    }
  }
}

// Excel keeps 15 significant digits; the binary value may carry noise
// (654.75 stored as 654.75000000000011). Rounding to 15 digits gives back what
// Excel shows, so "654.75" reaches the amount parser, not a 17-digit string.
function formatNumber(number) {
  return String(Number(number.toPrecision(15)));
}

// Days since Excel's epoch → "DD/MM/YYYY", the day-first text the date
// parser already understands. The time part (a fraction) is dropped.
// 1900 system: serial 1 is 1900-01-01, and Excel wrongly counts 29 Feb 1900,
// so from serial 61 on the epoch is effectively 30 Dec 1899. Earlier serials
// can't be statement dates; they're left as numbers and fail as dates later.
function serialToDayFirst(serial, date1904) {
  const days = Math.floor(serial);
  if (!date1904 && days < 61) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + days * 86_400_000);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function isoToDayFirst(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

// "A" → 0, "Z" → 25, "AA" → 26. "B12" → 1.
function columnIndex(ref) {
  const letters = /^([A-Z]{1,3})\d+$/.exec(ref)?.[1];
  if (!letters) throw malformed(`"${ref}" is not a cell reference`);
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

// ---------- XML plumbing ----------

// Streams one zip entry through a strict SAX parser, calling `handlers`
// with element names WITHOUT namespace prefixes ("x:row" → "row"; some
// writers use prefixes). With { streaming: true } it's an async generator
// that pauses after every chunk (so the sheet's rows can be yielded);
// otherwise it just runs to the end.
function parseEntry(zip, entry, handlers, { streaming = false } = {}) {
  const run = async function* () {
    const parser = sax.parser(true); // strict: malformed XML is an error, not a guess
    parser.onerror = (err) => {
      throw malformed(`invalid XML (${err.message.split('\n')[0]})`);
    };
    // A real .xlsx never has a DOCTYPE. Refusing it rules out entity tricks
    // (billion laughs, external entities) entirely.
    parser.ondoctype = () => {
      throw malformed('unexpected DOCTYPE');
    };
    parser.onopentag = (node) => handlers.open?.(localName(node.name), node.attributes);
    parser.onclosetag = (name) => handlers.close?.(localName(name));
    parser.ontext = (text) => handlers.text?.(text);
    parser.oncdata = (text) => handlers.text?.(text);

    // fatal: invalid UTF-8 is an error instead of silently becoming "�".
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const stream = await zip.openReadStreamPromise(entry);
    try {
      for await (const chunk of stream) {
        parser.write(decoder.decode(chunk, { stream: true }));
        yield;
      }
      parser.write(decoder.decode());
      parser.close();
    } finally {
      stream.destroy(); // stops decompressing if we stopped early
    }
  };

  if (streaming) return run();
  return (async () => {
    for await (const _ of run());
  })();
}

function localName(name) {
  return name.slice(name.indexOf(':') + 1);
}

// <sheet r:id="rId1">: the prefix varies between writers, the local name doesn't.
function attrByLocalName(attrs, wanted) {
  const key = Object.keys(attrs).find((k) => k.includes(':') && localName(k) === wanted);
  return key ? attrs[key] : undefined;
}

function required(entries, name) {
  const entry = entries.get(name);
  if (!entry) throw malformed(`${name} is missing`);
  return entry;
}

function appendCapped(current, text) {
  const next = current + text;
  if (next.length > MAX_CELL_CHARS) throw malformed('a cell is unreasonably large');
  return next;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Content problems are already ParseErrors (thrown by the handlers above),
// and so is text that isn't UTF-8. Anything else — a disk error, the zip
// failing although the upload gate accepted it, a bug here — is OUR problem:
// it stays as-is, so the job is logged and retried instead of telling the
// user their file is broken.
function toParseError(err) {
  if (err.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return malformed('text is not valid UTF-8');
  return err;
}

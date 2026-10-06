// Turning stored values into text for people (PDF) and spreadsheets (CSV).
// Amounts stay integers (paise) until the very last moment: no floating
// point ever touches money.

// 13325000 → "1,33,250.00" (Indian grouping, for reading).
export function formatRupees(paise) {
  if (paise === null || paise === undefined) return '';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${sign}${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

// 13325000 → "133250.00" (no grouping: spreadsheets read it as a number).
export function plainRupees(paise) {
  if (paise === null || paise === undefined) return '';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// "2026-09-01" → "01/09/2026", the day-first form Indian users read.
export function formatDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

// One CSV cell. Quoted when it contains a comma, quote or line break.
//
// Formula injection: a spreadsheet runs a cell starting with = + - @ (or a
// tab / carriage return) as a formula. A bank description is text we didn't
// write — "=HYPERLINK(...)" must stay text — so such cells get a leading '.
export function csvCell(value, { text = true } = {}) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function csvLine(cells) {
  return `${cells.join(',')}\r\n`; // CRLF: what spreadsheets expect (RFC 4180)
}

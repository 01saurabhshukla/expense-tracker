// Turning single raw cell strings into real values. Each parser returns
// { value } on success or { error: { code, message } } on failure, never
// throws, so the caller can report the problem against the right row.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Day always comes first: Indian banks never write month-first dates.
const DATE_PATTERNS = [
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/, // 01/09/26  01/09/2026  01-09-2026
  /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4}|\d{2})$/, // 1 Sep 2026  01-Sep-2026
];

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

// → { value: 'YYYY-MM-DD' }. A plain date string on purpose: a statement date
// has no time or timezone, and a JS Date would silently add both.
export function parseDate(raw) {
  const text = String(raw ?? '').trim();

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const day = Number(match[1]);
    const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS[match[2].toLowerCase()];
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);

    // Build the date and check nothing rolled over: 31/02 would become 03/03.
    const date = new Date(Date.UTC(year, (month ?? 0) - 1, day));
    const isReal =
      month !== undefined &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;

    if (!isReal || year < MIN_YEAR || year > MAX_YEAR) break;
    return { value: `${year}-${pad(month)}-${pad(day)}` };
  }

  return { error: { code: 'INVALID_DATE', message: `"${text}" is not a valid date` } };
}

// Accepted number shapes (commas are only allowed in a correct grouping):
const AMOUNT_PATTERNS = [
  /^\d+(\.\d{1,2})?$/, // 22000.00
  /^\d{1,2}(,\d{2})*,\d{3}(\.\d{1,2})?$/, // Indian: 1,33,250.00  22,000.00
  /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/, // Western: 133,250.00
];

// ₹100 crore. Far beyond any personal transaction; anything bigger is a
// misread column (e.g. an account number in the amount cell).
export const MAX_AMOUNT_PAISE = 100_00_00_000 * 100;

// → { value: paise } for a number, { value: null } for an empty cell.
// Paise are whole numbers, so no floating-point rounding ever happens:
// "1,250.50" is split into "1250" and "50" and combined as integers.
export function parseAmountPaise(raw) {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return { value: null };

  if (/^[-(]/.test(text)) {
    return { error: { code: 'NEGATIVE_AMOUNT', message: `"${text}" is negative; amounts must be positive` } };
  }
  if (!AMOUNT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { error: { code: 'INVALID_AMOUNT', message: `"${text}" is not a valid amount` } };
  }

  const [rupees, fraction = ''] = text.replace(/,/g, '').split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));

  if (paise > MAX_AMOUNT_PAISE) {
    return { error: { code: 'AMOUNT_TOO_LARGE', message: `"${text}" is unrealistically large` } };
  }
  return { value: paise };
}

// → { value: 'debit' | 'credit' }
export function parseDirection(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['dr', 'd', 'debit'].includes(text)) return { value: 'debit' };
  if (['cr', 'c', 'credit'].includes(text)) return { value: 'credit' };
  return { error: { code: 'INVALID_DIRECTION', message: `"${String(raw ?? '').trim()}" is not Dr or Cr` } };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

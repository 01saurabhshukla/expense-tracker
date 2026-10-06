import { createHash } from 'node:crypto';

// Gives every transaction a fingerprint so the same real-world transaction
// is stored once per user, even when two statements overlap (D24).
//
// Built from what identifies a transaction at the bank:
//   date + direction + amount + bank reference + running balance
// The description is used ONLY when the bank gives neither a reference nor
// a balance: banks word the same payment differently between exports (app vs
// net banking), and using it otherwise would let one payment count twice.
//
// Rows that are still identical within one file (no reference, no balance,
// same everything) are numbered #1, #2, … in file order. An overlapping
// statement numbers them the same way, so they still match — and two genuine
// identical payments on one day stay two transactions.
//
// Streaming use (7i): one fingerprinter per file, called row by row in file
// order. It remembers how often each base key was seen (that's the only
// thing that grows with the file: one short entry per distinct transaction).
export function createFingerprinter() {
  const seen = new Map(); // base key → how many times seen so far in this file

  return (transaction) => {
    const base = baseKey(transaction);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return createHash('sha256').update(`${base}|#${occurrence}`).digest('hex');
  };
}

// Returns new objects: each transaction plus `fingerprint` (64 hex chars).
export function addFingerprints(transactions) {
  const fingerprint = createFingerprinter();
  return transactions.map((transaction) => ({ ...transaction, fingerprint: fingerprint(transaction) }));
}

function baseKey({ date, direction, amountPaise, reference, balancePaise, description }) {
  const parts = [date, direction, amountPaise, comparableReference(reference), balancePaise ?? ''];
  if (reference === null && balancePaise === null) {
    parts.push(description.toUpperCase().replace(/\s+/g, ' ').trim());
  }
  // JSON keeps the parts unambiguous: no value can fake a separator.
  return JSON.stringify(parts);
}

// Excel stores an all-digit reference as a number, so "0000006266119255" in
// the CSV export is 6266119255 in the .xlsx of the same statement. Leading
// zeros are dropped for the comparison only; the stored reference is
// untouched.
function comparableReference(reference) {
  if (reference === null) return '';
  return /^\d+$/.test(reference) ? reference.replace(/^0+(?=\d)/, '') : reference;
}

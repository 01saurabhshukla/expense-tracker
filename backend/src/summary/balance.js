// The running-balance check. Banks print the balance after every row, so
// each row must satisfy:
//
//   balance of this row = balance of the previous row ± this row's amount
//
// If that holds for every row, we read every amount and direction correctly
// and no row is missing. A mismatch means a row we skipped (a row error), a
// row the bank didn't export, or an amount we misread.
//
// It's a warning, not a failure: the transactions are still saved, and the
// user is told which lines to look at.

// How many mismatches are kept; the total is in `mismatchCount`.
const MAX_REPORTED_MISMATCHES = 20;

// Checks rows ONE AT A TIME, in file order, so a huge statement never has to
// be held in memory (7i). Usage:
//   const check = createBalanceCheck();
//   for (const t of transactions) check.add(t);
//   check.result();
//
// Most exports list the oldest row first; some list the newest first. Both
// readings are checked side by side, and the newest-first one is chosen only
// if it has fewer mismatches.
export function createBalanceCheck() {
  const oldestFirst = direction();
  const newestFirst = direction();
  let previous = null; // the previous row, if it had a balance
  let first = null; // first and last rows (in the file) that have a balance
  let last = null;

  return {
    add(row) {
      if (row.balancePaise === null) {
        previous = null; // a row without a balance can't be checked; don't compare across it
        return;
      }
      first ??= row;
      last = row;
      if (previous) {
        // Oldest first: this row's balance comes from the previous one.
        oldestFirst.compare(row.line, previous.balancePaise + signed(row), row.balancePaise);
        // Newest first: the previous row is the LATER one, so its balance
        // comes from this one.
        newestFirst.compare(previous.line, row.balancePaise + signed(previous), previous.balancePaise);
      }
      previous = row;
    },

    result() {
      if (!first || oldestFirst.checkedRows === 0) {
        return { status: 'unavailable', order: null, checkedRows: 0, openingPaise: null, closingPaise: null, mismatchCount: 0, mismatches: [] };
      }
      const useNewestFirst = newestFirst.mismatchCount < oldestFirst.mismatchCount;
      const chosen = useNewestFirst ? newestFirst : oldestFirst;
      // The oldest row's balance with its own amount undone = the balance before it.
      const oldest = useNewestFirst ? last : first;
      const newest = useNewestFirst ? first : last;
      return {
        status: chosen.mismatchCount === 0 ? 'ok' : 'mismatch',
        order: useNewestFirst ? 'newest_first' : 'oldest_first',
        checkedRows: chosen.checkedRows,
        openingPaise: oldest.balancePaise - signed(oldest),
        closingPaise: newest.balancePaise,
        mismatchCount: chosen.mismatchCount,
        mismatches: chosen.mismatches,
      };
    },
  };
}

// Counts for one reading direction.
function direction() {
  return {
    checkedRows: 0,
    mismatchCount: 0,
    mismatches: [],
    compare(line, expectedPaise, actualPaise) {
      this.checkedRows++;
      if (expectedPaise === actualPaise) return;
      this.mismatchCount++;
      if (this.mismatches.length < MAX_REPORTED_MISMATCHES) this.mismatches.push({ line, expectedPaise, actualPaise });
    },
  };
}

// The whole check for an array of transactions (in file order).
export function checkRunningBalance(transactions) {
  const check = createBalanceCheck();
  for (const t of transactions) check.add(t);
  return check.result();
}

// Money in raises the balance, money out lowers it.
function signed(t) {
  return t.direction === 'credit' ? t.amountPaise : -t.amountPaise;
}

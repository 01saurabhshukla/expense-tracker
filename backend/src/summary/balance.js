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

// `transactions` in file order (by line). Returns
//   { status: 'ok' | 'mismatch' | 'unavailable', order, checkedRows,
//     openingPaise, closingPaise, mismatchCount, mismatches: [{ line, expectedPaise, actualPaise }] }
export function checkRunningBalance(transactions) {
  const withBalance = transactions.filter((t) => t.balancePaise !== null);
  if (withBalance.length === 0) {
    return { status: 'unavailable', order: null, checkedRows: 0, openingPaise: null, closingPaise: null, mismatchCount: 0, mismatches: [] };
  }

  // Most exports list the oldest row first; some list the newest first.
  // Try the file order, and the reverse only if the file order doesn't add up.
  let order = 'oldest_first';
  let chain = walk(transactions);
  if (chain.mismatches.length > 0) {
    const reversed = walk([...transactions].reverse());
    if (reversed.mismatches.length < chain.mismatches.length) {
      order = 'newest_first';
      chain = reversed;
    }
  }

  const status = chain.checkedRows === 0 ? 'unavailable' : chain.mismatches.length === 0 ? 'ok' : 'mismatch';
  return {
    status,
    order: status === 'unavailable' ? null : order,
    checkedRows: chain.checkedRows,
    openingPaise: chain.openingPaise,
    closingPaise: chain.closingPaise,
    mismatchCount: chain.mismatches.length,
    mismatches: chain.mismatches.slice(0, MAX_REPORTED_MISMATCHES),
  };
}

// Walks oldest → newest. Only neighbouring rows that BOTH have a balance are
// compared; a row without one can't be checked and isn't guessed.
function walk(rows) {
  const mismatches = [];
  let checkedRows = 0;
  let previous = null;

  for (const row of rows) {
    if (row.balancePaise === null) {
      previous = null;
      continue;
    }
    if (previous) {
      const expected = previous.balancePaise + signed(row);
      checkedRows++;
      if (expected !== row.balancePaise) {
        mismatches.push({ line: row.line, expectedPaise: expected, actualPaise: row.balancePaise });
      }
    }
    previous = row;
  }

  const first = rows.find((r) => r.balancePaise !== null);
  const last = rows.findLast((r) => r.balancePaise !== null);
  return {
    mismatches,
    checkedRows,
    // The balance before the oldest row: undo that row's own amount.
    openingPaise: first.balancePaise - signed(first),
    closingPaise: last.balancePaise,
  };
}

// Money in raises the balance, money out lowers it.
function signed(t) {
  return t.direction === 'credit' ? t.amountPaise : -t.amountPaise;
}

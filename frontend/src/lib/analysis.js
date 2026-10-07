// Analysis for the dashboard, computed from GET /dashboard (and nothing
// else), so it always matches the numbers shown around it.

// Spending in four fixed groups, for the "where it goes" pie. Fixed groups
// (not "top N categories") keep each colour meaning the same thing whatever
// the filters, and four slices stay readable. Colours are CSS variable
// names; series-1..3 are the palette slots validated for every pair.
export const SPENDING_GROUPS = [
  { key: 'essentials', label: 'Essentials', color: 'series-1', categories: ['rent', 'utilities', 'groceries', 'health', 'transport', 'fuel'] },
  { key: 'lifestyle', label: 'Lifestyle', color: 'series-2', categories: ['food_dining', 'shopping', 'entertainment', 'travel'] },
  { key: 'savings', label: 'Savings & investments', color: 'series-3', categories: ['investments'] },
  { key: 'other', label: 'Other', color: 'other', categories: null }, // cash, transfers out, uncategorized…
];

// Money in by source, for the second pie.
export const INCOME_SOURCES = [
  { key: 'salary', label: 'Salary', color: 'series-1', categories: ['salary'] },
  { key: 'received', label: 'Money received', color: 'series-2', categories: ['transfers_in'] },
  { key: 'interest', label: 'Interest', color: 'series-3', categories: ['interest'] },
  { key: 'other', label: 'Other money in', color: 'other', categories: null }, // refunds, cashback…
];

// byCategory rows → one slice per group with money in it, in the groups'
// fixed order. Each slice lists the category names it contains.
export function groupShares(byCategory, groups, field) {
  const listed = new Set(groups.flatMap((g) => g.categories ?? []));
  const slices = groups.map((group) => {
    const rows = byCategory.filter((c) => (group.categories ? group.categories.includes(c.category) : !listed.has(c.category)));
    const members = rows.filter((c) => c[field] > 0);
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      valuePaise: members.reduce((sum, c) => sum + c[field], 0),
      members: members.map((c) => c.name),
    };
  });
  return slices.filter((s) => s.valuePaise > 0);
}

// The headline numbers of the "At a glance" row.
export function insights({ totals, period, timeline, granularity }) {
  const days = period.from ? daysBetween(period.from, period.to) : 0;

  // Share of the money that came in and wasn't spent (negative: overspent).
  const keptRatio = totals.creditPaise > 0 ? totals.netPaise / totals.creditPaise : null;

  // Spending in the last two COMPLETE periods. A period the data only
  // partly covers (statements to 6 Oct → October has 6 days) would compare
  // a few days against a whole month and always look like a big drop.
  const complete = timeline.filter((p) => p.period >= period.from && periodEnd(p.period, granularity) <= period.to);
  let change = null;
  if (complete.length >= 2) {
    const current = complete.at(-1);
    const previous = complete.at(-2);
    if (previous.debitPaise > 0) {
      change = {
        currentPeriod: current.period,
        previousPeriod: previous.period,
        currentPaise: current.debitPaise,
        previousPaise: previous.debitPaise,
        ratio: (current.debitPaise - previous.debitPaise) / previous.debitPaise,
        granularity,
      };
    }
  }

  return {
    keptRatio,
    days,
    dailyAveragePaise: days > 0 ? Math.round(totals.debitPaise / days) : null,
    change,
  };
}

// The last day of the day / week (Monday start) / month beginning at `start`.
export function periodEnd(start, granularity) {
  const d = new Date(`${start}T00:00:00Z`);
  if (granularity === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (granularity === 'week') return new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  return start;
}

// Inclusive: 1 Sep to 30 Sep is 30 days. Plain dates, no time zone.
export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000) + 1;
}

// Sorts a copy by a numeric field: "desc" = highest first.
export function sortByAmount(rows, field, order) {
  const sign = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (a[field] - b[field]));
}

export function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

// A share of a total for labels: "<1%" rather than a misleading "0%".
export function sharePercent(part, total) {
  if (total <= 0 || part <= 0) return '0%';
  const value = (part / total) * 100;
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

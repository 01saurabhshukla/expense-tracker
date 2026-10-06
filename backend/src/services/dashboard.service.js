import { AppError } from '../errors.js';
import { CATEGORIES } from '../categorize/categories.js';
import { totalsForUser, byCategoryForUser, timelineForUser, topMerchantsForUser } from '../db/queries/dashboard.js';

// More points than this can't be drawn usefully; ask for a coarser grouping.
const MAX_PERIODS = 1000;
const TOP_MERCHANTS = 10;

// Everything the dashboard draws, for one set of filters:
//   totals       money in, money out, net, count, and the date range covered
//   byCategory   per category (only categories present, in list order)
//   timeline     per day / week / month, gaps filled with zeros, each with
//                money out per category (for a stacked chart)
//   topMerchants the 10 merchants with the most money out
export async function getDashboard(userId, { granularity, ...filters }) {
  const [totals, categories, timelineRows, topMerchants] = await Promise.all([
    totalsForUser(userId, filters),
    byCategoryForUser(userId, filters),
    timelineForUser(userId, filters, granularity),
    topMerchantsForUser(userId, filters, TOP_MERCHANTS),
  ]);

  const { from, to, ...sums } = totals;
  const periods = from ? periodStarts(from, to, granularity) : [];
  if (periods.length > MAX_PERIODS) {
    throw new AppError(400, 'TOO_MANY_PERIODS', `That range has more than ${MAX_PERIODS} ${granularity}s; choose a shorter range or a coarser grouping.`, {
      max: MAX_PERIODS,
    });
  }

  const byKey = new Map(categories.map((row) => [row.category, row]));
  return {
    granularity,
    period: { from, to },
    totals: withNet(sums),
    byCategory: CATEGORIES.filter(({ key }) => byKey.has(key)).map(({ key, name, kind }) => {
      const { category, ...rest } = byKey.get(key);
      return { category, name, kind, ...withNet(rest) };
    }),
    timeline: buildTimeline(periods, timelineRows),
    topMerchants,
  };
}

function buildTimeline(periods, rows) {
  const points = new Map(
    periods.map((period) => [period, { period, count: 0, debitPaise: 0, creditPaise: 0, spendingByCategory: {} }]),
  );
  for (const row of rows) {
    const point = points.get(row.period);
    point.count += row.count;
    point.debitPaise += row.debitPaise;
    point.creditPaise += row.creditPaise;
    if (row.debitPaise > 0) point.spendingByCategory[row.category] = row.debitPaise;
  }
  return [...points.values()].map(withNet);
}

// Every period start from the one containing `from` to the one containing
// `to`, so the chart has a point (possibly zero) for every period. Matches
// Postgres date_trunc: weeks start on Monday. UTC throughout: these are
// plain dates, no time zone.
export function periodStarts(from, to, granularity) {
  const start = truncate(parse(from), granularity);
  const end = parse(to);
  const starts = [];
  // Stops one past the limit: enough to know it's too many, without
  // building a million dates for "every day in 3000 years".
  for (let d = start; d <= end && starts.length <= MAX_PERIODS; d = next(d, granularity)) starts.push(format(d));
  return starts;
}

function truncate(date, granularity) {
  if (granularity === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (granularity === 'week') return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000);
  return date;
}

function next(date, granularity) {
  if (granularity === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return new Date(date.getTime() + (granularity === 'week' ? 7 : 1) * 86_400_000);
}

const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const format = (date) => date.toISOString().slice(0, 10);

function withNet(totals) {
  return { ...totals, netPaise: totals.creditPaise - totals.debitPaise };
}

import { describe, expect, it } from 'vitest';
import { groupShares, insights, daysBetween, periodEnd, sharePercent, sortByAmount, SPENDING_GROUPS, INCOME_SOURCES } from './analysis.js';

const row = (category, name, debitPaise, creditPaise = 0) => ({ category, name, debitPaise, creditPaise });
const byCategory = [
  row('rent', 'Rent & Housing', 4400000),
  row('groceries', 'Groceries', 328702),
  row('food_dining', 'Food & Dining', 280064),
  row('shopping', 'Shopping', 2856808),
  row('investments', 'Investments', 1000000),
  row('cash', 'Cash Withdrawal', 1000000),
  row('uncategorized', 'Uncategorized', 50000, 20000),
  row('salary', 'Salary', 0, 17000000),
  row('transfers_in', 'Money Received', 0, 350000),
  row('interest', 'Interest', 0, 41255),
];

describe('pie slices', () => {
  it('spending groups add up to all money out, in a fixed order', () => {
    const slices = groupShares(byCategory, SPENDING_GROUPS, 'debitPaise');
    expect(slices.map((s) => s.key)).toEqual(['essentials', 'lifestyle', 'savings', 'other']);
    expect(slices[0]).toMatchObject({ valuePaise: 4728702, members: ['Rent & Housing', 'Groceries'] });
    expect(slices[3].members).toEqual(['Cash Withdrawal', 'Uncategorized']); // anything not listed → Other
    const total = byCategory.reduce((n, c) => n + c.debitPaise, 0);
    expect(slices.reduce((n, s) => n + s.valuePaise, 0)).toBe(total);
  });

  it('empty groups are left out, but the others keep their colour', () => {
    const slices = groupShares([row('shopping', 'Shopping', 100)], SPENDING_GROUPS, 'debitPaise');
    expect(slices).toEqual([{ key: 'lifestyle', label: 'Lifestyle', color: 'series-2', valuePaise: 100, members: ['Shopping'] }]);
  });

  it('money in by source; credits in other categories (refunds) count as "Other money in"', () => {
    const slices = groupShares(byCategory, INCOME_SOURCES, 'creditPaise');
    expect(slices.map((s) => [s.key, s.valuePaise])).toEqual([
      ['salary', 17000000],
      ['received', 350000],
      ['interest', 41255],
      ['other', 20000],
    ]);
  });
});

describe('insights', () => {
  const totals = { creditPaise: 20000000, debitPaise: 15000000, netPaise: 5000000 };
  const timeline = [
    { period: '2026-08-01', debitPaise: 8000000 },
    { period: '2026-09-01', debitPaise: 10000000 },
  ];

  it('share kept, daily average over the period, change vs the previous period', () => {
    const result = insights({ totals, period: { from: '2026-08-01', to: '2026-09-30' }, timeline, granularity: 'month' });
    expect(result.keptRatio).toBe(0.25);
    expect(result.days).toBe(61);
    expect(result.dailyAveragePaise).toBe(Math.round(15000000 / 61));
    expect(result.change).toMatchObject({ ratio: 0.25, currentPeriod: '2026-09-01', previousPeriod: '2026-08-01' });
  });

  it('no money in, one period, nothing previous to compare: no made-up numbers', () => {
    const result = insights({
      totals: { creditPaise: 0, debitPaise: 100, netPaise: -100 },
      period: { from: '2026-09-01', to: '2026-09-01' },
      timeline: [{ period: '2026-09-01', debitPaise: 100 }],
      granularity: 'month',
    });
    expect(result.keptRatio).toBeNull();
    expect(result.change).toBeNull();
    expect(result.days).toBe(1);
  });

  it('compares only complete periods: a month the data barely covers is not a "drop"', () => {
    // Statements from 1 Aug to 6 Oct: August and September are complete, October is not.
    const tl = [
      { period: '2026-08-01', debitPaise: 9000000 },
      { period: '2026-09-01', debitPaise: 8000000 },
      { period: '2026-10-01', debitPaise: 500000 },
    ];
    const result = insights({ totals, period: { from: '2026-08-01', to: '2026-10-06' }, timeline: tl, granularity: 'month' });
    expect(result.change).toMatchObject({ currentPeriod: '2026-09-01', previousPeriod: '2026-08-01' });
    expect(result.change.ratio).toBeCloseTo(-1 / 9);
  });

  it('with fewer than two complete periods there is no comparison', () => {
    const tl = [
      { period: '2026-09-01', debitPaise: 8000000 },
      { period: '2026-10-01', debitPaise: 500000 },
    ];
    expect(insights({ totals, period: { from: '2026-09-01', to: '2026-10-06' }, timeline: tl, granularity: 'month' }).change).toBeNull();
  });

  it('period ends: day, Monday week, month (leap February included)', () => {
    expect(periodEnd('2026-09-14', 'day')).toBe('2026-09-14');
    expect(periodEnd('2026-08-31', 'week')).toBe('2026-09-06');
    expect(periodEnd('2028-02-01', 'month')).toBe('2028-02-29');
  });

  it('shares: a tiny one says <1%, not 0%', () => {
    expect(sharePercent(41255, 17391255)).toBe('<1%');
    expect(sharePercent(350000, 17391255)).toBe('2%');
    expect(sharePercent(0, 100)).toBe('0%');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(30);
  });
});

describe('sorting', () => {
  it('highest first and lowest first', () => {
    const rows = [{ v: 2 }, { v: 9 }, { v: 5 }];
    expect(sortByAmount(rows, 'v', 'desc').map((r) => r.v)).toEqual([9, 5, 2]);
    expect(sortByAmount(rows, 'v', 'asc').map((r) => r.v)).toEqual([2, 5, 9]);
    expect(rows.map((r) => r.v)).toEqual([2, 9, 5]); // the original is untouched
  });
});

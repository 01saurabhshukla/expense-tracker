// Date range presets for the filter bar. Dates are "YYYY-MM-DD" strings in
// the user's own calendar (local time), like the dates on a bank statement.

export function toIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Each preset → { from, to } (undefined = open-ended).
export const DATE_PRESETS = [
  { key: 'all', label: 'All time', range: () => ({}) },
  { key: 'this_month', label: 'This month', range: (now) => ({ from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDate(now) }) },
  {
    key: 'last_month',
    label: 'Last month',
    range: (now) => ({
      from: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)), // day 0 = last day of previous month
    }),
  },
  { key: 'last_3_months', label: 'Last 3 months', range: (now) => ({ from: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: toIsoDate(now) }) },
  { key: 'this_year', label: 'This year', range: (now) => ({ from: toIsoDate(new Date(now.getFullYear(), 0, 1)), to: toIsoDate(now) }) },
  {
    key: 'last_year',
    label: 'Last year',
    range: (now) => ({ from: toIsoDate(new Date(now.getFullYear() - 1, 0, 1)), to: toIsoDate(new Date(now.getFullYear() - 1, 11, 31)) }),
  },
];

// Which preset (if any) matches a from/to pair, for showing the selection.
export function presetFor({ from, to }, now = new Date()) {
  return DATE_PRESETS.find((preset) => {
    const range = preset.range(now);
    return (range.from ?? '') === (from ?? '') && (range.to ?? '') === (to ?? '');
  })?.key ?? 'custom';
}

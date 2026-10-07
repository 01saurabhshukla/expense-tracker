import { describe, expect, it } from 'vitest';
import { formatRupees, formatRupeesShort, formatDate, formatPeriod } from './format.js';
import { DATE_PRESETS, presetFor } from './dates.js';
import { checkFile } from './uploads.js';
import { toQuery } from '../api/endpoints.js';

describe('money', () => {
  it('formats paise with Indian grouping, never via floats', () => {
    expect(formatRupees(13325000)).toBe('₹1,33,250.00');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(-1000050)).toBe('−₹10,000.50');
    expect(formatRupees(8500000, { sign: true })).toBe('+₹85,000.00');
    expect(formatRupees(null)).toBe('—');
  });

  it('short axis labels use lakh and crore', () => {
    expect(formatRupeesShort(4500000)).toBe('₹45K');
    expect(formatRupeesShort(12000000)).toBe('₹1.2L');
    expect(formatRupeesShort(130000000)).toBe('₹13L');
    expect(formatRupeesShort(1300000000)).toBe('₹1.3Cr');
  });
});

describe('dates', () => {
  it('formats plain dates without time-zone shifts', () => {
    expect(formatDate('2026-09-01')).toBe('01/09/2026');
    expect(formatPeriod('2026-09-01', 'month')).toBe('Sep 2026');
    expect(formatPeriod('2026-08-31', 'week')).toBe('31 Aug');
  });

  it('presets produce the right ranges', () => {
    const now = new Date(2026, 9, 7); // 7 Oct 2026
    const range = (key) => DATE_PRESETS.find((p) => p.key === key).range(now);
    expect(range('this_month')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(range('last_month')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(range('last_3_months')).toEqual({ from: '2026-08-01', to: '2026-10-07' });
    expect(range('last_year')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(range('all')).toEqual({});
  });

  it('recognises which preset a range is', () => {
    const now = new Date(2026, 9, 7);
    expect(presetFor({}, now)).toBe('all');
    expect(presetFor({ from: '2026-09-01', to: '2026-09-30' }, now)).toBe('last_month');
    expect(presetFor({ from: '2026-09-03', to: '2026-09-30' }, now)).toBe('custom');
  });
});

describe('uploads', () => {
  const file = (name, size = 100) => ({ name, size });
  it('checks files before uploading', () => {
    expect(checkFile(file('statement.csv'))).toBeNull();
    expect(checkFile(file('Statement.XLSX'))).toBeNull();
    expect(checkFile(file('old.xls'))).toMatch(/save as .xlsx/);
    expect(checkFile(file('photo.png'))).toMatch(/Only .csv and .xlsx/);
    expect(checkFile(file('empty.csv', 0))).toMatch(/empty/);
    expect(checkFile(file('big.csv', 11 * 1024 * 1024))).toMatch(/10 MB/);
  });
});

describe('toQuery', () => {
  it('drops empty values (the backend rejects unknown or empty parameters)', () => {
    expect(toQuery({ from: '2026-09-01', category: '', q: undefined, limit: 50 })).toBe('from=2026-09-01&limit=50');
  });
});

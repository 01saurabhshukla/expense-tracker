import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPeriod, formatRupees, formatRupeesShort } from '../../lib/format.js';
import { useThemeColors } from '../../hooks/useThemeColors.js';

const COLORS = ['series-1', 'series-2', 'grid', 'axis', 'text-muted', 'accent-wash'];

// Money in and out per day / week / month. Two series on ONE axis (same unit),
// grouped bars, a legend, a hover tooltip, and a table view of every value.
export function Timeline({ timeline, granularity }) {
  const [asTable, setAsTable] = useState(false);
  const colors = useThemeColors(COLORS);
  const data = timeline.map((p) => ({
    label: formatPeriod(p.period, granularity),
    moneyOut: p.debitPaise,
    moneyIn: p.creditPaise,
    net: p.netPaise,
  }));

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="legend" aria-hidden={asTable}>
          <span><i style={{ background: colors['series-1'] }} />Money out</span>
          <span><i style={{ background: colors['series-2'] }} />Money in</span>
        </div>
        <button type="button" className="link" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Period</th><th className="num">Money out</th><th className="num">Money in</th><th className="num">Net</th></tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="num">{formatRupees(d.moneyOut)}</td>
                  <td className="num">{formatRupees(d.moneyIn)}</td>
                  <td className="num">{formatRupees(d.net, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label="Bar chart of money in and money out over time. Use 'Show as table' for the values.">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: colors.axis }} tick={{ fill: colors['text-muted'], fontSize: 12 }} minTickGap={12} />
              <YAxis tickFormatter={formatRupeesShort} tickLine={false} axisLine={false} tick={{ fill: colors['text-muted'], fontSize: 12 }} width={56} />
              <Tooltip content={<TimelineTooltip colors={colors} />} cursor={{ fill: colors['accent-wash'] }} />
              <Bar dataKey="moneyOut" name="Money out" fill={colors['series-1']} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="moneyIn" name="Money in" fill={colors['series-2']} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

// Values lead, series names follow; a short line in the series colour as key.
function TimelineTooltip({ active, payload, label, colors }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="muted">{label}</div>
      <div className="row-line"><span className="key" style={{ background: colors['series-1'] }} /><strong>{formatRupees(point.moneyOut)}</strong> money out</div>
      <div className="row-line"><span className="key" style={{ background: colors['series-2'] }} /><strong>{formatRupees(point.moneyIn)}</strong> money in</div>
      <div className="muted">Net {formatRupees(point.net, { sign: true })}</div>
    </div>
  );
}

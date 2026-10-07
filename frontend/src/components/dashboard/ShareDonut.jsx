import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import { formatRupees } from '../../lib/format.js';
import { useThemeColors } from '../../hooks/useThemeColors.js';
import { sharePercent } from '../../lib/analysis.js';

const COLOR_NAMES = ['series-1', 'series-2', 'series-3', 'other', 'surface'];

// A donut for "share of the whole at a glance": at most 4 fixed slices, a
// 2 px gap between them, the total in the middle, and a legend that is also
// the table view (name, amount, share, what's inside) — so no value depends
// on colour or on hovering.
export function ShareDonut({ slices, totalLabel, ariaLabel }) {
  const colors = useThemeColors(COLOR_NAMES);
  const total = slices.reduce((sum, s) => sum + s.valuePaise, 0);
  const share = (s) => sharePercent(s.valuePaise, total);
  // "Salary" under "Salary" says nothing: list contents only when they add something.
  const showMembers = (s) => s.members.length > 1 || (s.members.length === 1 && s.members[0].toLowerCase() !== s.label.toLowerCase());

  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${share(s)}`).join(', ')}`}>
        <PieChart width={200} height={200}>
          <Pie
            data={slices}
            dataKey="valuePaise"
            nameKey="label"
            innerRadius={62}
            outerRadius={96}
            startAngle={90}
            endAngle={-270}
            stroke={colors.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((s) => (
              <Cell key={s.key} fill={colors[s.color]} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip total={total} colors={colors} />} />
        </PieChart>
        <div className="donut-center">
          <strong>{formatRupees(total)}</strong>
          <span>{totalLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: colors[s.color] }} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="num">
              {formatRupees(s.valuePaise)} <span className="muted">· {share(s)}</span>
            </span>
            {showMembers(s) && <span className="members">{s.members.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Value first, name second; a short line in the slice's colour as the key.
function DonutTooltip({ active, payload, total, colors }) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="row-line">
        <span className="key" style={{ background: colors[slice.color] }} />
        <strong>{formatRupees(slice.valuePaise)}</strong> {slice.label}
      </div>
      <div className="muted">{sharePercent(slice.valuePaise, total)} of the total</div>
    </div>
  );
}

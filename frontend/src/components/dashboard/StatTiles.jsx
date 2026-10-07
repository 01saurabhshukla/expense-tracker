import { formatRupees, formatDate } from '../../lib/format.js';

// The four headline numbers. Plain tiles, not charts: each is one number.
export function StatTiles({ totals, period }) {
  const covered = period.from ? `${formatDate(period.from)} – ${formatDate(period.to)}` : 'No transactions';
  return (
    <div className="stat-grid">
      <Tile label="Money in" value={formatRupees(totals.creditPaise)} />
      <Tile label="Money out" value={formatRupees(totals.debitPaise)} />
      <Tile
        label="Net"
        value={formatRupees(totals.netPaise, { sign: true })}
        good={totals.netPaise > 0}
        hint={totals.netPaise >= 0 ? 'More came in than went out' : 'More went out than came in'}
      />
      <Tile label="Transactions" value={totals.count.toLocaleString('en-IN')} hint={covered} />
    </div>
  );
}

function Tile({ label, value, hint, good }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value${good ? ' good' : ''}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}


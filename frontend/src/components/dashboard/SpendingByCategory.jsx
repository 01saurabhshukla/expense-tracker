import { Link } from 'react-router';
import { formatRupees } from '../../lib/format.js';
import { toQuery } from '../../api/endpoints.js';

// Where the money went: one bar per category, biggest first. A single series,
// so a single colour; every value is written next to its bar (this list IS
// the table view). Clicking a category opens its transactions.
export function SpendingByCategory({ byCategory, filters }) {
  const spending = byCategory.filter((c) => c.debitPaise > 0).sort((a, b) => b.debitPaise - a.debitPaise);
  if (spending.length === 0) return <p className="muted">No money out in this period.</p>;

  const max = spending[0].debitPaise;
  const total = spending.reduce((sum, c) => sum + c.debitPaise, 0);
  return (
    <div className="bar-list">
      {spending.map((c) => (
        <div className="bar-row" key={c.category}>
          <Link to={`/transactions?${toQuery({ ...filters, category: c.category, direction: 'debit' })}`}>{c.name}</Link>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${(c.debitPaise / max) * 100}%` }} />
          </div>
          <span className="num">
            {formatRupees(c.debitPaise)} <span className="muted">· {Math.round((c.debitPaise / total) * 100)}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

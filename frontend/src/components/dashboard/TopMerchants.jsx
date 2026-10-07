import { Link } from 'react-router';
import { formatRupees } from '../../lib/format.js';
import { categoryName, useCategories } from '../../hooks/useCategories.js';
import { toQuery } from '../../api/endpoints.js';
import { sortByAmount } from '../../lib/analysis.js';

// The 10 merchants with the most money out (from the API), shown highest or
// lowest first (`order`: "desc" | "asc").
export function TopMerchants({ merchants: unsorted, filters, order = 'desc' }) {
  const categories = useCategories();
  const merchants = sortByAmount(unsorted, 'debitPaise', order);
  if (merchants.length === 0) return <p className="muted">No merchants in this period.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Merchant</th><th>Category</th><th className="num">Payments</th><th className="num">Total</th></tr>
        </thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.merchantKey}>
              <td className="description">
                <Link to={`/transactions?${toQuery({ ...filters, merchant: m.merchantKey })}`}>{m.merchantKey}</Link>
              </td>
              <td>{categoryName(categories, m.category)}</td>
              <td className="num">{m.count}</td>
              <td className="num">{formatRupees(m.debitPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


import { useEffect, useState } from 'react';
import { listTransactions } from '../api/endpoints.js';
import { useApiData } from '../hooks/useApiData.js';
import { categoryName, useCategories } from '../hooks/useCategories.js';
import { pickFilters, useUrlFilters } from '../lib/filters.js';
import { formatDate, formatRupees, plural } from '../lib/format.js';
import { DateRangeFilter } from '../components/DateRangeFilter.jsx';
import { CategorySelect } from '../components/CategorySelect.jsx';
import { ExportButtons } from '../components/ExportButtons.jsx';
import { ErrorAlert } from '../components/ErrorAlert.jsx';
import { Spinner } from '../components/Spinner.jsx';
import { CorrectionDialog } from '../components/CorrectionDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const EXTRA_KEYS = ['sort', 'offset'];
const PAGE_SIZE = 50;
const SOURCE_LABEL = { user: 'You', rule: 'Rule', llm: 'AI', none: '—' };

export function TransactionsPage() {
  const [values, update] = useUrlFilters(EXTRA_KEYS);
  const filters = pickFilters(values);
  const offset = Number(values.offset ?? 0);
  const categories = useCategories();
  const toast = useToast();
  const [editing, setEditing] = useState(null);

  const { data, error, loading, refreshing, reload } = useApiData(
    () => listTransactions({ ...filters, sort: values.sort, limit: PAGE_SIZE, offset }),
    JSON.stringify(values),
  );

  // Any filter change goes back to the first page.
  const filter = (changes) => update({ ...changes, offset: undefined });

  const saved = ({ updatedCount, rule }) => {
    setEditing(null);
    toast(rule ? `Updated ${plural(updatedCount, 'transaction')} from ${rule.merchantKey}; future uploads will use it too.` : 'Updated 1 transaction.');
    reload();
  };

  return (
    <>
      <div className="page-header">
        <h1>Transactions</h1>
        <ExportButtons filters={filters} />
      </div>

      <div className="filter-bar">
        <SearchBox value={filters.q ?? ''} onSearch={(q) => filter({ q })} />
        <DateRangeFilter from={filters.from} to={filters.to} onChange={(range) => filter(range)} />
        <label>
          Category
          <CategorySelect includeAll value={filters.category} onChange={(category) => filter({ category })} />
        </label>
        <label>
          Type
          <select value={filters.direction ?? ''} onChange={(e) => filter({ direction: e.target.value })}>
            <option value="">In and out</option>
            <option value="debit">Money out</option>
            <option value="credit">Money in</option>
          </select>
        </label>
        <label>
          Sort
          <select value={values.sort ?? 'date_desc'} onChange={(e) => filter({ sort: e.target.value === 'date_desc' ? undefined : e.target.value })}>
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
          </select>
        </label>
        {(filters.merchant || filters.uploadId) && (
          <span className="badge neutral">
            {filters.merchant ? `Merchant: ${filters.merchant}` : 'One statement'}
            <button type="button" className="link" aria-label="Remove this filter" onClick={() => filter({ merchant: undefined, uploadId: undefined })}>×</button>
          </span>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && <Spinner />}

      {data && (
        <section className={`card${refreshing ? ' refreshing' : ''}`}>
          {data.transactions.length === 0 ? (
            <div className="empty">
              <p>No transactions match these filters.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                      <td className="description">{t.description}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="link" onClick={() => setEditing(t)} title="Change category">
                          {categoryName(categories, t.category)}
                        </button>{' '}
                        <span className="muted" style={{ fontSize: '0.75rem' }} title="Who decided this category">{SOURCE_LABEL[t.categorySource]}</span>
                      </td>
                      <td className={`num${t.direction === 'credit' ? ' amount-credit' : ''}`}>
                        {formatRupees(t.direction === 'credit' ? t.amountPaise : -t.amountPaise, { sign: true })}
                      </td>
                      <td className="num muted">{formatRupees(t.balancePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted">
              {data.transactions.length > 0 && `Showing ${offset + 1}–${offset + data.transactions.length}`}
            </span>
            <div className="row">
              <button type="button" disabled={offset === 0} onClick={() => update({ offset: Math.max(0, offset - PAGE_SIZE) || undefined })}>Previous</button>
              <button type="button" disabled={!data.pagination.hasMore} onClick={() => update({ offset: offset + PAGE_SIZE })}>Next</button>
            </div>
          </div>
        </section>
      )}

      {editing && <CorrectionDialog transaction={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}

// Searches as you type, but only after a short pause, so typing "swiggy"
// sends one request instead of six.
function SearchBox({ value, onSearch }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value) return undefined;
    const timer = setTimeout(() => onSearch(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label>
      Search
      <input type="search" placeholder="Description…" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

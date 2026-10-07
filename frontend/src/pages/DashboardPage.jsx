import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { getDashboard } from '../api/endpoints.js';
import { useApiData } from '../hooks/useApiData.js';
import { pickFilters, useUrlFilters } from '../lib/filters.js';
import { DateRangeFilter } from '../components/DateRangeFilter.jsx';
import { CategorySelect } from '../components/CategorySelect.jsx';
import { ExportButtons } from '../components/ExportButtons.jsx';
import { ErrorAlert } from '../components/ErrorAlert.jsx';
import { Spinner } from '../components/Spinner.jsx';
import { StatTiles } from '../components/dashboard/StatTiles.jsx';
import { SpendingByCategory } from '../components/dashboard/SpendingByCategory.jsx';
import { TopMerchants } from '../components/dashboard/TopMerchants.jsx';
import { Insights } from '../components/dashboard/Insights.jsx';
import { SortToggle } from '../components/SortToggle.jsx';
import { groupShares, INCOME_SOURCES, SPENDING_GROUPS } from '../lib/analysis.js';

// The chart library is most of the app's size: load it only for the charts.
const Timeline = lazy(() => import('../components/dashboard/Timeline.jsx').then((m) => ({ default: m.Timeline })));
const ShareDonut = lazy(() => import('../components/dashboard/ShareDonut.jsx').then((m) => ({ default: m.ShareDonut })));
const chartFallback = (height) => <div style={{ minHeight: height }}><Spinner label="Loading chart…" /></div>;

const EXTRA_KEYS = ['granularity'];
const GRANULARITIES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];

export function DashboardPage() {
  const [values, update] = useUrlFilters(EXTRA_KEYS);
  const filters = pickFilters(values);
  const granularity = values.granularity ?? 'month';
  const { data, error, loading, refreshing } = useApiData(() => getDashboard({ ...filters, granularity }), JSON.stringify(values));
  // Highest or lowest first, per list; only re-sorts, never refetches.
  const [categoryOrder, setCategoryOrder] = useState('desc');
  const [merchantOrder, setMerchantOrder] = useState('desc');

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <ExportButtons filters={filters} />
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="filter-bar">
        <DateRangeFilter from={filters.from} to={filters.to} onChange={(range) => update(range)} />
        <label>
          Category
          <CategorySelect includeAll value={filters.category} onChange={(category) => update({ category })} />
        </label>
        <label>
          Group by
          <span className="segmented">
            {GRANULARITIES.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={granularity === key} onClick={() => update({ granularity: key === 'month' ? undefined : key })}>
                {label}
              </button>
            ))}
          </span>
        </label>
        {Object.keys(values).length > 0 && (
          <button type="button" className="link" onClick={() => update(Object.fromEntries(Object.keys(values).map((k) => [k, undefined])))}>
            Clear filters
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {loading && <Spinner />}

      {data && data.totals.count === 0 && !filters.from && !filters.category ? (
        <div className="card empty">
          <h2>No transactions yet</h2>
          <p>Upload a bank statement (CSV or Excel) to see where your money goes.</p>
          <Link className="button" to="/uploads">Upload a statement</Link>
        </div>
      ) : (
        data && (
          <div className={`stack${refreshing ? ' refreshing' : ''}`} style={{ gap: 20 }}>
            <StatTiles totals={data.totals} period={data.period} />

            {data.totals.count > 0 && (
              <section className="card">
                <div className="card-header">
                  <h2>At a glance</h2>
                </div>
                <Insights data={data} filters={filters} granularity={granularity} />
              </section>
            )}

            <section className="card">
              <div className="card-header">
                <h2>Money in and out</h2>
                <span className="muted">per {granularity}</span>
              </div>
              {data.timeline.length > 0 ? (
                <Suspense fallback={chartFallback(330)}>
                  <Timeline timeline={data.timeline} granularity={granularity} />
                </Suspense>
              ) : (
                <p className="muted">No transactions in this period.</p>
              )}
            </section>

            <div className="grid-2">
              <section className="card">
                <div className="card-header">
                  <h2>Where the money goes</h2>
                  <span className="muted">money out by group</span>
                </div>
                <DonutOrEmpty slices={groupShares(data.byCategory, SPENDING_GROUPS, 'debitPaise')} totalLabel="money out" ariaLabel="Money out by group" empty="No money out in this period." />
              </section>
              <section className="card">
                <div className="card-header">
                  <h2>Where the money comes from</h2>
                  <span className="muted">money in by source</span>
                </div>
                <DonutOrEmpty slices={groupShares(data.byCategory, INCOME_SOURCES, 'creditPaise')} totalLabel="money in" ariaLabel="Money in by source" empty="No money in during this period." />
              </section>
            </div>

            <div className="grid-2">
              <section className="card">
                <div className="card-header">
                  <h2>Spending by category</h2>
                  <SortToggle value={categoryOrder} onChange={setCategoryOrder} label="Sort categories by spending" />
                </div>
                <SpendingByCategory byCategory={data.byCategory} filters={filters} order={categoryOrder} />
              </section>
              <section className="card">
                <div className="card-header">
                  <h2>Top merchants</h2>
                  <SortToggle value={merchantOrder} onChange={setMerchantOrder} label="Sort merchants by spending" />
                </div>
                <TopMerchants merchants={data.topMerchants} filters={filters} order={merchantOrder} />
              </section>
            </div>
          </div>
        )
      )}
    </>
  );
}

function DonutOrEmpty({ slices, totalLabel, ariaLabel, empty }) {
  if (slices.length === 0) return <p className="muted">{empty}</p>;
  return (
    <Suspense fallback={chartFallback(200)}>
      <ShareDonut slices={slices} totalLabel={totalLabel} ariaLabel={ariaLabel} />
    </Suspense>
  );
}

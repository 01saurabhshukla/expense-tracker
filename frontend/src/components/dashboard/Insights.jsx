import { Link } from 'react-router';
import { listTransactions, toQuery } from '../../api/endpoints.js';
import { useApiData } from '../../hooks/useApiData.js';
import { insights, percent } from '../../lib/analysis.js';
import { formatDate, formatPeriod, formatRupees } from '../../lib/format.js';

// "At a glance": four plain facts about the filtered period. Each is a
// number with words, not a colour: spending going up is shown as "more",
// not as red, because whether that's bad depends on the person.
export function Insights({ data, filters, granularity }) {
  const facts = insights({ totals: data.totals, period: data.period, timeline: data.timeline, granularity });

  // The single biggest payment out, from the same filters.
  const canHaveDebits = filters.direction !== 'credit';
  const biggest = useApiData(
    () => (canHaveDebits ? listTransactions({ ...filters, direction: 'debit', sort: 'amount_desc', limit: 1 }) : null),
    JSON.stringify(filters),
  );
  const top = biggest.data?.transactions?.[0];

  return (
    <div className="insight-grid">
      <div className="insight">
        <div className="label">Kept from money in</div>
        {facts.keptRatio === null ? (
          <>
            <div className="value">—</div>
            <div className="hint">No money came in during this period.</div>
          </>
        ) : facts.keptRatio >= 0 ? (
          <>
            <div className="value">{percent(facts.keptRatio)}</div>
            <div className="hint">of what came in was not spent.</div>
          </>
        ) : (
          <>
            <div className="value">Overspent by {percent(-facts.keptRatio)}</div>
            <div className="hint">More went out than came in.</div>
          </>
        )}
      </div>

      <div className="insight">
        <div className="label">Average spending per day</div>
        <div className="value">{facts.dailyAveragePaise === null ? '—' : formatRupees(facts.dailyAveragePaise)}</div>
        <div className="hint">
          {facts.days > 0 ? `Money out over ${facts.days} day${facts.days === 1 ? '' : 's'} (${formatDate(data.period.from)} – ${formatDate(data.period.to)}).` : 'No transactions.'}
        </div>
      </div>

      <div className="insight">
        <div className="label">Biggest single payment</div>
        {top ? (
          <>
            <div className="value">{formatRupees(top.amountPaise)}</div>
            <div className="hint">
              {formatDate(top.date)} · {top.merchantKey ?? (top.description.length > 60 ? `${top.description.slice(0, 60)}…` : top.description)}{' '}
              <Link to={`/transactions?${toQuery({ ...filters, direction: 'debit', sort: 'amount_desc' })}`}>See largest</Link>
            </div>
          </>
        ) : (
          <>
            <div className="value">—</div>
            <div className="hint">{biggest.loading ? 'Loading…' : 'No money out in this view.'}</div>
          </>
        )}
      </div>

      <div className="insight">
        <div className="label">Spending vs previous complete {granularity}</div>
        {facts.change ? (
          <>
            <div className="value">
              {facts.change.ratio === 0
                ? 'No change'
                : `${facts.change.ratio > 0 ? '↑' : '↓'} ${percent(Math.abs(facts.change.ratio))} ${facts.change.ratio > 0 ? 'more' : 'less'}`}
            </div>
            <div className="hint">
              {formatPeriod(facts.change.currentPeriod, granularity)}: {formatRupees(facts.change.currentPaise)} · {formatPeriod(facts.change.previousPeriod, granularity)}:{' '}
              {formatRupees(facts.change.previousPaise)}
            </div>
          </>
        ) : (
          <>
            <div className="value">—</div>
            <div className="hint">Needs two complete {granularity}s in this view to compare (a {granularity} the statements only partly cover would mislead).</div>
          </>
        )}
      </div>
    </div>
  );
}

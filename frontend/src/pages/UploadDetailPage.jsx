import { Link, useParams } from 'react-router';
import { getUpload, toQuery } from '../api/endpoints.js';
import { useApiData } from '../hooks/useApiData.js';
import { usePolling } from '../hooks/usePolling.js';
import { categoryName, useCategories } from '../hooks/useCategories.js';
import { formatBytes, formatDate, formatDateTime, formatRupees, plural } from '../lib/format.js';
import { isFinished, STAGES } from '../lib/uploads.js';
import { StageBadge } from '../components/StageBadge.jsx';
import { ErrorAlert } from '../components/ErrorAlert.jsx';
import { Spinner } from '../components/Spinner.jsx';

// One upload: live progress while it's processed (polled every 1.5 s), then
// the import report — totals, categories, the running-balance check and any
// rows that couldn't be read.
export function UploadDetailPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApiData(() => getUpload(id).then((r) => r.upload), id);
  usePolling(reload, 1500, data !== undefined && !isFinished(data));

  if (loading) return <Spinner />;
  if (error && !data) {
    return (
      <>
        <ErrorAlert error={error} />
        <Link to="/uploads">Back to uploads</Link>
      </>
    );
  }
  const upload = data;
  const p = upload.progress ?? {};

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/uploads" className="muted">← Uploads</Link>
          <h1 style={{ overflowWrap: 'anywhere' }}>{upload.originalFilename}</h1>
          <span className="muted">{upload.format.toUpperCase()} · {formatBytes(upload.sizeBytes)} · uploaded {formatDateTime(upload.createdAt)}</span>
        </div>
        <StageBadge upload={upload} />
      </div>

      <section className="card stack">
        <Stages upload={upload} />
        {!isFinished(upload) && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={p.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${p.percent ?? 0}%` }} />
            </div>
            <span className="muted">
              {p.rowsRead ? `${p.rowsRead.toLocaleString('en-IN')} rows read · ${(p.transactionsFound ?? 0).toLocaleString('en-IN')} transactions found` : 'Starting…'}
              {p.rowErrors ? ` · ${plural(p.rowErrors, 'problem row')}` : ''}
            </span>
            <span className="muted">You can leave this page; processing continues in the background.</span>
          </>
        )}
        {upload.stage === 'failed' && (
          <ErrorAlert error={{ ...upload.error, message: upload.error?.message }} title="We couldn't import this file." />
        )}
      </section>

      {upload.stage === 'completed' && <Report upload={upload} />}
      {upload.rowErrors?.length > 0 && <RowErrors upload={upload} />}
    </>
  );
}

function Stages({ upload }) {
  const current = STAGES.findIndex(([key]) => key === upload.stage);
  const failed = upload.stage === 'failed';
  return (
    <ol className="stages" aria-label="Processing steps">
      {STAGES.map(([key, label], i) => {
        const state = failed ? (i === 0 ? 'done' : '') : i < current || upload.stage === 'completed' ? 'done' : i === current ? 'current' : '';
        return <li key={key} className={state} aria-current={state === 'current' ? 'step' : undefined}>{label}</li>;
      })}
      {failed && <li className="failed">Failed</li>}
    </ol>
  );
}

function Report({ upload }) {
  const categories = useCategories();
  const p = upload.progress;
  const s = upload.summary;
  return (
    <>
      <div className="stat-grid">
        <div className="card stat"><div className="label">New transactions</div><div className="value">{p.transactionsSaved.toLocaleString('en-IN')}</div>
          <div className="hint">{p.duplicatesSkipped ? `${p.duplicatesSkipped} were already imported from another statement` : 'None were duplicates'}</div></div>
        {s && <div className="card stat"><div className="label">Money in</div><div className="value">{formatRupees(s.totals.creditPaise)}</div></div>}
        {s && <div className="card stat"><div className="label">Money out</div><div className="value">{formatRupees(s.totals.debitPaise)}</div></div>}
        {s && <div className="card stat"><div className="label">Period</div><div className="value" style={{ fontSize: '1.1rem' }}>{formatDate(s.period.from)} – {formatDate(s.period.to)}</div></div>}
      </div>

      {s && <BalanceCheck balance={s.balance} />}

      {s && (
        <section className="card">
          <div className="card-header">
            <h2>By category <span className="muted" style={{ fontWeight: 400 }}>· at import</span></h2>
            <Link to={`/transactions?${toQuery({ uploadId: upload.id })}`}>View these transactions</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category</th><th className="num">Count</th><th className="num">Money out</th><th className="num">Money in</th></tr></thead>
              <tbody>
                {s.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{categoryName(categories, c.category)}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">{c.debitPaise ? formatRupees(c.debitPaise) : '—'}</td>
                    <td className="num">{c.creditPaise ? formatRupees(c.creditPaise) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Categorised by your rules: {p.categorizedBy?.user ?? 0} · by built-in rules: {p.categorizedBy?.rule ?? 0} · uncategorised: {p.categorizedBy?.none ?? 0}
          </p>
        </section>
      )}
    </>
  );
}

// The running-balance check (backend D26): does every row's balance follow
// from the previous one? A mismatch is a warning, with the lines to look at.
function BalanceCheck({ balance }) {
  if (balance.status === 'unavailable') {
    return <div className="alert">This statement has no balance column, so it couldn't be cross-checked.</div>;
  }
  if (balance.status === 'ok') {
    return (
      <div className="alert success">
        ✓ Every running balance adds up ({balance.checkedRows.toLocaleString('en-IN')} rows checked).
        Opening {formatRupees(balance.openingPaise)}, closing {formatRupees(balance.closingPaise)}.
      </div>
    );
  }
  return (
    <div className="alert warning">
      <strong>⚠ The running balance doesn't add up in {plural(balance.mismatchCount, 'place')}.</strong> Usually this means a row
      above couldn't be read (see the problem rows below) or the bank left a row out. Check line{balance.mismatches.length > 1 ? 's' : ''}{' '}
      {balance.mismatches.map((m) => m.line).join(', ')}{balance.mismatchCount > balance.mismatches.length ? '…' : ''} in your file.
    </div>
  );
}

function RowErrors({ upload }) {
  const total = upload.progress?.rowErrors ?? upload.rowErrors.length;
  return (
    <section className="card">
      <div className="card-header">
        <h2>Rows we couldn't read</h2>
        <span className="muted">{total > upload.rowErrors.length ? `first ${upload.rowErrors.length} of ${total}` : plural(total, 'row')}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th className="num">Line</th><th>Problem</th></tr></thead>
          <tbody>
            {upload.rowErrors.map((e) => (
              <tr key={`${e.line}-${e.code}`}><td className="num">{e.line}</td><td>{e.message}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

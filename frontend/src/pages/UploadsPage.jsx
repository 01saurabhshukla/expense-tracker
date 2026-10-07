import { useState } from 'react';
import { Link } from 'react-router';
import { listUploads } from '../api/endpoints.js';
import { useApiData } from '../hooks/useApiData.js';
import { usePolling } from '../hooks/usePolling.js';
import { formatBytes, formatDateTime, plural } from '../lib/format.js';
import { isFinished } from '../lib/uploads.js';
import { UploadDropzone } from '../components/UploadDropzone.jsx';
import { StageBadge } from '../components/StageBadge.jsx';
import { ErrorAlert } from '../components/ErrorAlert.jsx';
import { Spinner } from '../components/Spinner.jsx';

const PAGE_SIZE = 20;

export function UploadsPage() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useApiData(() => listUploads({ limit: PAGE_SIZE, offset }), offset);
  const anyRunning = data?.uploads.some((u) => !isFinished(u));

  // While something is processing, refresh the list every 2 s (D23: the
  // frontend polls; stages and progress live in the database).
  usePolling(reload, 2000, anyRunning);

  return (
    <>
      <div className="page-header">
        <h1>Uploads</h1>
      </div>
      <UploadDropzone onUploaded={reload} />

      <section className="card">
        <div className="card-header">
          <h2>Your statements</h2>
        </div>
        <ErrorAlert error={error} />
        {loading && <Spinner />}
        {data && data.uploads.length === 0 && <p className="muted">Nothing uploaded yet.</p>}
        {data && data.uploads.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>File</th><th>Uploaded</th><th>Status</th><th className="num">Transactions</th></tr>
              </thead>
              <tbody>
                {data.uploads.map((u) => (
                  <tr key={u.id}>
                    <td className="description">
                      <Link to={`/uploads/${u.id}`}>{u.originalFilename}</Link>{' '}
                      <span className="muted">{u.format.toUpperCase()} · {formatBytes(u.sizeBytes)}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(u.createdAt)}</td>
                    <td><StageBadge upload={u} /></td>
                    <td className="num">{summaryText(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (offset > 0 || data.pagination.hasMore) && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <button type="button" disabled={!data.pagination.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </div>
        )}
      </section>
    </>
  );
}

function summaryText(upload) {
  const p = upload.progress ?? {};
  if (upload.stage === 'failed') return upload.error?.code === 'INTERNAL_ERROR' ? 'Error' : '—';
  if (upload.stage !== 'completed') return p.transactionsFound ? `${p.transactionsFound.toLocaleString('en-IN')} found…` : '…';
  const parts = [plural(p.transactionsSaved ?? 0, 'new', 'new')];
  if (p.duplicatesSkipped) parts.push(`${p.duplicatesSkipped} already imported`);
  if (p.rowErrors) parts.push(plural(p.rowErrors, 'problem row'));
  return parts.join(' · ');
}

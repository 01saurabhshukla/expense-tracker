import { useState } from 'react';
import { downloadCsv, downloadPdf } from '../api/endpoints.js';
import { asApiError } from './ErrorAlert.jsx';
import { useToast } from './Toast.jsx';

// Downloads exactly what's on screen: the same filters go to the export.
export function ExportButtons({ filters }) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn(filters);
    } catch (err) {
      toast(`Export failed: ${asApiError(err).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="row">
      <button type="button" onClick={() => run('csv', downloadCsv)} disabled={busy !== null}>
        {busy === 'csv' ? 'Preparing…' : 'Export CSV'}
      </button>
      <button type="button" onClick={() => run('pdf', downloadPdf)} disabled={busy !== null}>
        {busy === 'pdf' ? 'Preparing…' : 'PDF report'}
      </button>
    </div>
  );
}

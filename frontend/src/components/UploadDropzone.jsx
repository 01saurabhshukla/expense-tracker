import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { uploadStatement } from '../api/upload.js';
import { asApiError } from './ErrorAlert.jsx';
import { checkFile, UPLOAD_ERROR_TEXT } from '../lib/uploads.js';
import { formatBytes } from '../lib/format.js';

// Drop or pick statement files. Each file is uploaded on its own request,
// one after another, with a progress bar. When the backend has the file it
// answers at once; processing then continues in the background (shown in
// the list below).
export function UploadDropzone({ onUploaded }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState([]); // { id, file, status, progress, error, upload, abort }

  const patch = (id, changes) => setItems((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const addFiles = async (files) => {
    const added = [...files].map((file) => ({ id: crypto.randomUUID(), file, status: 'waiting', progress: 0, error: checkFile(file) }));
    setItems((list) => [...added, ...list]);
    for (const item of added) {
      if (item.error) {
        patch(item.id, { status: 'rejected' });
        continue;
      }
      const { promise, abort } = uploadStatement(item.file, { onProgress: (progress) => patch(item.id, { progress }) });
      patch(item.id, { status: 'uploading', abort });
      try {
        const upload = await promise;
        patch(item.id, { status: 'done', upload, progress: 1 });
        onUploaded?.(upload);
      } catch (err) {
        const error = asApiError(err);
        patch(item.id, {
          status: error.code === 'ABORTED' ? 'cancelled' : 'rejected',
          error: UPLOAD_ERROR_TEXT[error.code] ?? error.message,
          existingUploadId: error.details?.existingUploadId,
        });
      }
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  return (
    <div className="stack">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>Drop bank statements here, or click to choose</strong>
        <span className="muted">CSV or Excel (.xlsx), up to 10 MB each · HDFC, SBI, ICICI, Axis, Kotak</span>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ''; // allow choosing the same file again
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-live="polite">
          {items.map((item) => (
            <li key={item.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ overflowWrap: 'anywhere' }}>
                  <strong>{item.file.name}</strong> <span className="muted">{formatBytes(item.file.size)}</span>
                </span>
                {item.status === 'uploading' && (
                  <button type="button" className="link" onClick={() => item.abort?.()}>Cancel</button>
                )}
                {item.status === 'done' && <Link to={`/uploads/${item.upload.id}`}>Uploaded · view progress</Link>}
                {item.status === 'waiting' && <span className="muted">Waiting…</span>}
                {item.status === 'cancelled' && <span className="muted">Cancelled</span>}
              </div>
              {item.status === 'uploading' && (
                <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${item.progress * 100}%` }} />
                </div>
              )}
              {item.status === 'rejected' && (
                <div className="field-error" style={{ marginTop: 6 }}>
                  {item.error}{' '}
                  {item.existingUploadId && <Link to={`/uploads/${item.existingUploadId}`}>See the earlier upload</Link>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

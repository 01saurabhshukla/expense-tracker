import { useEffect, useRef, useState } from 'react';
import { updateTransactionCategory } from '../api/endpoints.js';
import { CategorySelect } from './CategorySelect.jsx';
import { ErrorAlert, asApiError } from './ErrorAlert.jsx';

// Change a transaction's category. By default the correction is remembered
// for the merchant: every transaction from it is re-labelled now, and future
// uploads use it too (backend D29). Unticking changes only this one row.
export function CorrectionDialog({ transaction, onClose, onSaved }) {
  const dialog = useRef(null);
  const [category, setCategory] = useState(transaction.category);
  const [applyToMerchant, setApplyToMerchant] = useState(Boolean(transaction.merchantKey));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await updateTransactionCategory(transaction.id, { category, applyToMerchant });
      onSaved(result);
    } catch (err) {
      setError(asApiError(err));
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="correction-title">
      <form onSubmit={submit}>
        <h2 id="correction-title">Change category</h2>
        <p className="secondary" style={{ margin: 0, overflowWrap: 'anywhere' }}>{transaction.description}</p>
        <label className="field">
          Category
          <CategorySelect value={category} onChange={setCategory} autoFocus />
        </label>
        {transaction.merchantKey ? (
          <label className="row" style={{ fontWeight: 400, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={applyToMerchant} onChange={(e) => setApplyToMerchant(e.target.checked)} style={{ minHeight: 0, marginTop: 4 }} />
            <span>
              Always use this for <strong>{transaction.merchantKey}</strong>
              <br />
              <span className="muted">Re-labels all its transactions and future uploads.</span>
            </span>
          </label>
        ) : (
          <p className="muted" style={{ margin: 0 }}>This transaction has no recognisable merchant, so only it will change.</p>
        )}
        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="primary" disabled={saving || (category === transaction.category && !applyToMerchant)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

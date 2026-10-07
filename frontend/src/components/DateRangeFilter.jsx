import { useState } from 'react';
import { DATE_PRESETS, presetFor } from '../lib/dates.js';

// Preset ranges first ("This month", "Last 3 months"…); "Custom…" shows two
// date inputs. Dates from the URL that match no preset count as custom.
export function DateRangeFilter({ from, to, onChange }) {
  const [customOpen, setCustomOpen] = useState(false);
  const selected = customOpen ? 'custom' : presetFor({ from, to });

  const choose = (key) => {
    if (key === 'custom') return setCustomOpen(true);
    setCustomOpen(false);
    const range = DATE_PRESETS.find((p) => p.key === key).range(new Date());
    onChange({ from: range.from, to: range.to });
  };

  return (
    <>
      <label>
        Period
        <select value={selected} onChange={(e) => choose(e.target.value)}>
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {selected === 'custom' && (
        <>
          <label>
            From
            <input type="date" value={from ?? ''} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
          </label>
          <label>
            To
            <input type="date" value={to ?? ''} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
          </label>
        </>
      )}
    </>
  );
}

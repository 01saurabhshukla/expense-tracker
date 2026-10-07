// "Highest first" / "Lowest first" for a ranked list.
export function SortToggle({ value, onChange, label = 'Sort' }) {
  return (
    <span className="segmented" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === 'desc'} onClick={() => onChange('desc')}>Highest first</button>
      <button type="button" aria-pressed={value === 'asc'} onClick={() => onChange('asc')}>Lowest first</button>
    </span>
  );
}

import { useCategories } from '../hooks/useCategories.js';

// A <select> of the fixed categories, grouped by kind.
export function CategorySelect({ value, onChange, includeAll = false, label, ...props }) {
  const categories = useCategories();
  const groups = [
    ['expense', 'Spending'],
    ['income', 'Income'],
    ['other', 'Other'],
  ];
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} {...props}>
      {includeAll && <option value="">All categories</option>}
      {groups.map(([kind, title]) => (
        <optgroup key={kind} label={title}>
          {categories.filter((c) => c.kind === kind).map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

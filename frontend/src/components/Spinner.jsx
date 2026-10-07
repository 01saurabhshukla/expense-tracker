export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="row muted" role="status">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

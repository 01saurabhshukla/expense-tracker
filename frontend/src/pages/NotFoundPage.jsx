import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="card empty">
      <h1>Page not found</h1>
      <Link to="/">Go to the dashboard</Link>
    </div>
  );
}

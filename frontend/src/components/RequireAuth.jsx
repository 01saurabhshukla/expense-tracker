import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Spinner } from './Spinner.jsx';

// Pages behind login. While the session is being restored from the refresh
// cookie, show a spinner instead of bouncing to the login page.
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="auth-page">
        <Spinner label="Loading your account…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    // Remember where they were going, to return there after logging in.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

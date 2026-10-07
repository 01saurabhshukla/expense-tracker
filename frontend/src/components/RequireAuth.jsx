import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Spinner } from './Spinner.jsx';
import { LandingPage } from '../pages/LandingPage.jsx';

// Pages behind login. While the session is being restored from the refresh
// cookie, show a spinner instead of bouncing to the login page. Logged out,
// "/" shows the landing page and every other page goes to login.
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
    // The home page: visitors see the landing page; members, the dashboard.
    if (location.pathname === '/') return <LandingPage />;
    // Remember where they were going, to return there after logging in.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

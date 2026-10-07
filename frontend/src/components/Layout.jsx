import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          Expense Tracker
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/uploads">Uploads</NavLink>
          <NavLink to="/rules">Rules</NavLink>
        </nav>
        <div className="user-menu">
          <span className="user-name">{user?.name}</span>
          <ThemeToggle />
          <button type="button" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}

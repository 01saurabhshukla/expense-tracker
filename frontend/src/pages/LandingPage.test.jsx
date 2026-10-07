import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// Logged out: the session check (refresh) is refused.
function renderLoggedOut(path) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'No refresh token' } }), { status: 401 })));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RequireAuth><p>Dashboard</p></RequireAuth>} />
          <Route path="/transactions" element={<RequireAuth><p>Transactions</p></RequireAuth>} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('home page', () => {
  it('logged out, "/" shows the landing page with sign-up and login', async () => {
    renderLoggedOut('/');
    expect(await screen.findByRole('heading', { level: 1, name: /See where your money went/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Create (a free )?account/ })[0]).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Dashboard', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('logged out, other pages still go to login', async () => {
    renderLoggedOut('/transactions');
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('the theme button switches between light and dark and remembers it', async () => {
    renderLoggedOut('/');
    const toDark = await screen.findByRole('button', { name: 'Switch to dark theme' });
    await userEvent.click(toDark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider.jsx';
import { LoginPage } from './LoginPage.jsx';

afterEach(() => vi.unstubAllGlobals());

function renderLogin(fetchMock) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Dashboard here</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const json = (status, body) => new Response(JSON.stringify(body), { status });

describe('LoginPage', () => {
  it('shows the backend message for wrong credentials', async () => {
    renderLogin(vi.fn(async (url) => {
      if (url.endsWith('/auth/refresh')) return json(401, { error: { code: 'UNAUTHENTICATED', message: 'No refresh token' } });
      return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect', requestId: 'req-9' } });
    }));
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByRole('alert')).toHaveTextContent('req-9');
  });

  it('logs in and goes to the dashboard', async () => {
    renderLogin(vi.fn(async (url) => {
      if (url.endsWith('/auth/refresh')) return json(401, { error: { code: 'UNAUTHENTICATED', message: 'No refresh token' } });
      return json(200, { user: { id: 'u1', name: 'Asha' }, accessToken: 't', expiresIn: 900 });
    }));
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Dashboard here')).toBeTruthy();
  });
});

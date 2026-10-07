import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/endpoints.js';
import { onSessionEnded, clearSession } from '../api/client.js';

// Who is logged in, for the whole app.
//   status: 'loading' (checking the refresh cookie on page load)
//         | 'authenticated' | 'anonymous'
const AuthContext = createContext(null);

// Logging out in one tab logs out every tab of this app.
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('expense-tracker-auth') : null;

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });

  useEffect(() => {
    let cancelled = false;
    api
      .restoreSession()
      .then((user) => !cancelled && setState({ status: 'authenticated', user, notice: null }))
      .catch(() => !cancelled && setState({ status: 'anonymous', user: null, notice: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stopListening = onSessionEnded(() =>
      setState({ status: 'anonymous', user: null, notice: 'Your session has ended. Please log in again.' }),
    );
    const onMessage = (event) => {
      if (event.data !== 'logout') return;
      clearSession();
      setState({ status: 'anonymous', user: null, notice: 'You logged out in another tab.' });
    };
    channel?.addEventListener('message', onMessage);
    return () => {
      stopListening();
      channel?.removeEventListener('message', onMessage);
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const user = await api.login(credentials);
    setState({ status: 'authenticated', user, notice: null });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      channel?.postMessage('logout');
      setState({ status: 'anonymous', user: null, notice: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

import { API_URL } from '../config.js';

// Talks to the backend. Owns the session:
//
//   access token  short-lived (15 min), kept ONLY in memory (this module).
//                 Never in localStorage: a script injected into the page
//                 could read it from there.
//   refresh token httpOnly cookie set by the backend on /auth; JavaScript
//                 can't read it at all. Sent only to /auth/* requests.
//
// Every API call goes through request(): it adds the access token, and when
// the backend says TOKEN_EXPIRED it refreshes once and retries the call.

let accessToken = null;
let accessTokenExpiresAt = 0; // ms since epoch
let refreshing = null; // the refresh in progress, shared by everyone waiting
const sessionEndedListeners = new Set();

// Refresh a little before expiry, so a request never leaves with a token
// that dies on the way (and a long upload never starts with one).
const REFRESH_MARGIN_MS = 60_000;

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// ---------- session ----------

export function setSession({ accessToken: token, expiresIn }) {
  accessToken = token;
  accessTokenExpiresAt = Date.now() + expiresIn * 1000;
}

export function clearSession() {
  accessToken = null;
  accessTokenExpiresAt = 0;
}

export function hasSession() {
  return accessToken !== null;
}

// Called when the session can't be renewed (logged out elsewhere, expired,
// revoked): the app goes back to the login page.
export function onSessionEnded(listener) {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

function endSession(reason) {
  clearSession();
  for (const listener of sessionEndedListeners) listener(reason);
}

// Gets a new access token using the refresh cookie.
//
// The backend ROTATES the refresh token on every use and treats a reused one
// as theft (it logs the whole session out). So two refreshes must never run
// at the same time with the same cookie:
//   - within this tab, everyone shares one promise (`refreshing`);
//   - across tabs, the Web Locks API queues them: the second tab waits, and
//     by then the browser already holds the new cookie from the first.
export function refreshSession() {
  refreshing ??= withRefreshLock(async () => {
    const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw await toApiError(res);
    setSession(await res.json());
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function withRefreshLock(fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request('expense-tracker-refresh', fn);
  return fn(); // very old browsers: per-tab protection only
}

export async function freshAccessToken() {
  if (!accessToken || Date.now() > accessTokenExpiresAt - REFRESH_MARGIN_MS) {
    try {
      await refreshSession();
    } catch (err) {
      endSession('expired');
      throw err;
    }
  }
  return accessToken;
}

// ---------- requests ----------

// `body` objects are sent as JSON. `auth: false` for login/signup.
// `credentials` only for /auth/* (the refresh cookie lives there).
export async function request(path, { method = 'GET', body, auth = true, credentials, raw = false } = {}) {
  const send = async () => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = `Bearer ${await freshAccessToken()}`;
    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials,
    });
  };

  let res = await send();
  if (auth && res.status === 401) {
    const err = await toApiError(res);
    if (err.code !== 'TOKEN_EXPIRED') {
      endSession('unauthenticated');
      throw err;
    }
    // Expired on the way (clock skew, laptop sleep): renew once and retry.
    try {
      await refreshSession();
    } catch (refreshErr) {
      endSession('expired');
      throw refreshErr;
    }
    res = await send();
  }

  if (!res.ok) throw await toApiError(res);
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

// The backend always answers errors as { error: { status, code, message,
// details, requestId } }. Anything else (a proxy's HTML page, no network)
// becomes a generic error with the HTTP status.
export async function toApiError(res) {
  try {
    const { error } = await res.json();
    if (error?.code) return new ApiError(error);
  } catch {
    // not JSON
  }
  return new ApiError({ status: res.status, code: 'HTTP_ERROR', message: `Request failed (${res.status})` });
}

// Downloads a file (CSV/PDF export) and hands it to the browser to save.
// Needs the token, so a plain <a href> can't be used.
export async function download(path) {
  const res = await request(path, { raw: true });
  const blob = await res.blob();
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

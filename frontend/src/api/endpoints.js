import { request, download, setSession, clearSession, refreshSession } from './client.js';

// One function per backend endpoint. Pages call these, never fetch() directly.

// ---------- auth ----------

export async function signup({ name, email, password }) {
  return request('/auth/signup', { method: 'POST', body: { name, email, password }, auth: false });
}

export async function login({ email, password }) {
  // credentials: 'include' lets the browser store the refresh cookie the
  // backend sets on a different origin (the API).
  const result = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false, credentials: 'include' });
  setSession(result);
  return result.user;
}

// On page load: is there still a valid refresh cookie? Then we're logged in.
export async function restoreSession() {
  await refreshSession();
  return (await request('/auth/me')).user;
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST', auth: false, credentials: 'include' });
  } finally {
    clearSession();
  }
}

// ---------- uploads ----------

export const listUploads = ({ limit = 20, offset = 0 } = {}) => request(`/uploads?${new URLSearchParams({ limit, offset })}`);
export const getUpload = (id) => request(`/uploads/${encodeURIComponent(id)}`);

// ---------- transactions & categories ----------

export const listTransactions = (query) => request(`/transactions?${toQuery(query)}`);
export const updateTransactionCategory = (id, { category, applyToMerchant }) =>
  request(`/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { category, applyToMerchant } });

export const listCategories = () => request('/categories');
export const listRules = () => request('/categories/rules');
export const deleteRule = (id) => request(`/categories/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------- dashboard & exports ----------

export const getDashboard = (query) => request(`/dashboard?${toQuery(query)}`);
export const downloadCsv = (filters) => download(`/exports/transactions.csv?${toQuery(filters)}`);
export const downloadPdf = (filters) => download(`/exports/report.pdf?${toQuery(filters)}`);

// Leaves out empty values: the backend rejects unknown or empty parameters
// (strict validation), so only real filters are sent.
export function toQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  return query.toString();
}

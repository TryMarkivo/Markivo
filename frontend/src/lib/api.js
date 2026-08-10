// Central API client for Markivo.
//
// - Base URL comes from VITE_API_URL (falls back to localhost for dev).
// - Tokens live in localStorage; access tokens are short-lived and this client
//   transparently refreshes them once on a 401/403 before retrying the request.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

const ACCESS_KEY = 'markivo_token';
const REFRESH_KEY = 'markivo_refresh';

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set: (data = {}) => {
    const access = data.accessToken || data.token;
    if (access) localStorage.setItem(ACCESS_KEY, access);
    if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

async function tryRefresh() {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    tokens.clear();
    return false;
  }
  tokens.set(await res.json());
  return true;
}

async function request(path, { method = 'GET', body, auth = true, _retried = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const access = tokens.access();
  if (auth && access) headers['Authorization'] = `Bearer ${access}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Cannot reach the Markivo server. Please ensure the backend is running.');
    e.isNetwork = true;
    throw e;
  }

  // Expired/invalid access token — refresh once, then retry the original call.
  if ((res.status === 401 || res.status === 403) && auth && !_retried && tokens.refresh()) {
    if (await tryRefresh()) return request(path, { method, body, auth, _retried: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export const api = {
  base: API_BASE,
  tokens,
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),

  // Uploaded media is served by the API, not the Vite dev server, so a bare
  // "/uploads/x.jpg" has to be resolved against the API origin. Absolute URLs
  // (already-public render results) pass through untouched.
  mediaUrl: (url) => (!url ? '' : url.startsWith('http') ? url : API_BASE + (url.startsWith('/') ? url : `/${url}`)),

  async register(payload) {
    const data = await request('/api/auth/register', { method: 'POST', body: payload, auth: false });
    tokens.set(data);
    return data;
  },
  async login(payload) {
    const data = await request('/api/auth/login', { method: 'POST', body: payload, auth: false });
    tokens.set(data);
    return data;
  },
  // Irreversible. The server erases the account and everything cascading from
  // it, so the local session is cleared regardless of what happens next.
  async deleteAccount() {
    const data = await request('/api/me', { method: 'DELETE' });
    tokens.clear();
    return data;
  },
  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', body: { refreshToken: tokens.refresh() }, auth: false });
    } catch {
      /* best-effort; clear locally regardless */
    }
    tokens.clear();
  },
};

export default api;

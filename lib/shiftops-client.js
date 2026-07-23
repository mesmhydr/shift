'use client';

const TOKEN_KEY = 'shiftops_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (typeof window === 'undefined') return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, opts = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

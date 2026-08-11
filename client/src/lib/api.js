const TOKEN_KEY = 'civiceye_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function parseResponse(res) {
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const msg = body?.error || body?.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }
  return body;
}

export async function api(path, { method = 'GET', body, formData, params } = {}) {
  const BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;
  const url = new URL(path, BASE_URL);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }

  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  return parseResponse(res);
}

export const http = {
  get: (path, params) => api(path, { params }),
  post: (path, body) => api(path, { method: 'POST', body }),
  patch: (path, body) => api(path, { method: 'PATCH', body }),
  del: (path) => api(path, { method: 'DELETE' }),
  upload: (path, formData) => api(path, { method: 'POST', formData }),
};

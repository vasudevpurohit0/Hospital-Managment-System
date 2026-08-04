const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const AUTH_STORAGE_KEY = 'esic-hms-auth';

export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed.token || null;
  } catch {
    return null;
  }
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  explicitToken?: string | null,
): Promise<Response> {
  const token = explicitToken || getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Default to application/json if body is present and no Content-Type set
  if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...options,
      headers,
    });
  } catch {
    // If primary backend URL fails, fall back to relative path (proxy)
    try {
      res = await fetch(path, {
        ...options,
        headers,
      });
    } catch {
      throw new Error('Unable to connect to the server. Please make sure the backend is running.');
    }
  }

  if (res.status === 401) {
    try {
      const clone = res.clone();
      const err = await clone.json();
      if (err.message === 'jwt expired' || err.message === 'Unauthorized' || res.status === 401) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  return res;
}

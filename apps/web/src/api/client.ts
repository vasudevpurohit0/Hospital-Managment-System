export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const AUTH_STORAGE_KEY = 'esic-hms-auth';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/**
 * A-02 (2026-09-22 audit): a normal (non-impersonation) session no longer
 * stores a real bearer token at all -- see useAuth.ts's `login()` -- so
 * `apiFetch` below authenticates it purely via the httpOnly cookie
 * (`credentials: 'include'`). That cookie is `SameSite=None` in production
 * (cross-site by registrable domain between Vercel and Railway), which
 * reopens CSRF risk a `Strict`/`Lax` cookie would have ruled out by
 * construction -- this is the double-submit half of that defense: the
 * random `csrf` claim the backend embeds in the token at issuance, handed
 * back once in the login/refresh response body (never in a cookie, since a
 * cookie set by the API's own origin isn't JS-readable from the frontend's
 * origin anyway), stored here, and echoed back on every mutating
 * cookie-authenticated request. See security.middleware.ts on the API side
 * for the matching verification.
 */
export function getStoredCsrfToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) return null;
    return parsed.csrfToken || null;
  } catch {
    return null;
  }
}

/**
 * When acting as the platform Super Admin who has "entered" a hospital, every
 * request needs X-Hospital-Id so the backend knows which tenant schema to
 * route to (a hospital-staff token never needs this -- its own JWT already
 * embeds its hospital). This is the single choke point that makes every
 * existing *.api.ts module work unmodified for a Super Admin inside a
 * hospital.
 */
export function getActiveHospitalHeader(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.mode === 'platform' && parsed.activeHospital?.id) {
      return parsed.activeHospital.id as string;
    }
    return null;
  } catch {
    return null;
  }
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  explicitToken?: string | null,
): Promise<Response> {
  // Distinguishes "no override given" (undefined -- look the token up as
  // usual) from "explicitly no bearer token" (null -- e.g. useAuth.ts
  // revoking a root session that was itself cookie-only; falling back to
  // getStoredToken() there would grab the WRONG, currently-active
  // impersonation session's token instead). A normal session's own
  // getStoredToken() now also returns null (see A-02 note above), so this
  // resolves to null for it either way -- the distinction only matters for
  // that one explicit-override case.
  const token = explicitToken === undefined ? getStoredToken() : explicitToken;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Default to application/json if body is present and no Content-Type set
  if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (MUTATING_METHODS.has((options.method || 'GET').toUpperCase()) && !headers['X-CSRF-Token']) {
    // No bearer token means this request authenticates via the httpOnly
    // cookie (credentials: 'include' below) -- attach the double-submit
    // CSRF header for anything that mutates state. Read requests don't need
    // it (see security.middleware.ts: only MUTATING_METHODS are checked).
    const csrfToken = getStoredCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const activeHospitalId = getActiveHospitalHeader();
  if (activeHospitalId) {
    headers['X-Hospital-Id'] = activeHospitalId;
  }

  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    // If primary backend URL fails, fall back to relative path (proxy)
    try {
      res = await fetch(path, {
        ...options,
        headers,
        credentials: 'include',
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

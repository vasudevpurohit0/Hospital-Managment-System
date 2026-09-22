import { Response } from 'express';

/**
 * Names deliberately distinct per token type (and from the platform token)
 * so a hospital-staff cookie and a platform-admin cookie can never collide
 * or be confused for one another on a browser that's logged into both in
 * different tabs.
 */
export const ACCESS_TOKEN_COOKIE = 'esic_access_token';
export const PLATFORM_TOKEN_COOKIE = 'esic_platform_token';
export const REFRESH_TOKEN_COOKIE = 'esic_refresh_token';

const ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // matches this app's existing 8h access-token JWT expiry
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches the refresh JWT's own 7d expiry

/**
 * V-XX (this session): the access token was previously only ever handed to
 * the browser as a JSON body field, which the frontend then had to persist
 * itself -- and it persisted it to localStorage, JS-readable and therefore
 * exfiltratable by any successful XSS. Setting it ALSO as an httpOnly
 * cookie here means the frontend no longer needs to store the raw token
 * anywhere JS can read it at all: the browser attaches the cookie
 * automatically, and GET /auth/me (already existing) re-hydrates
 * "who's logged in" from it on page load.
 *
 * The JSON body still carries the token too (unchanged) -- every existing
 * e2e/unit test and any non-browser API consumer (a future mobile client,
 * a script) keeps working exactly as before. This is additive, not a
 * breaking replacement.
 *
 * `sameSite`/`secure` (2026-09-22 audit correction -- was unconditionally
 * `sameSite: 'strict'`): the frontend (Vercel) and API (Railway) are on
 * entirely different registrable domains in production, which makes that
 * relationship cross-site by definition. A `'strict'` (or even `'lax'`)
 * cookie is *never* attached to a cross-site `fetch()`/XHR request no
 * matter what `credentials` mode the caller uses -- confirmed this was
 * silently making the cookie-based auth fallback unusable in the actual
 * deployed topology (curl-based testing during the audit didn't catch it,
 * since curl doesn't enforce SameSite at all). `SameSite=None` requires
 * `Secure` (browsers reject `None` without it), and `Secure` cookies are
 * simply never sent over plain HTTP -- which local dev runs on. So both are
 * conditional on NODE_ENV: local dev's `localhost:5173` -> `localhost:3000`
 * is same-site regardless of port (SameSite is scoped to the registrable
 * domain, not the port), so `'lax'` + non-`Secure` works there over HTTP
 * exactly as before; only the real cross-site production deployment needs
 * `'none'` + `Secure`.
 *
 * Making the cookie cross-site-sendable in production reopens real CSRF
 * risk (a malicious site can trigger a request the browser will still
 * attach this cookie to) that `'strict'` used to rule out by construction.
 * That's why this is paired with a genuine double-submit CSRF check now
 * (see the `csrf` claim embedded in every access token at issuance in
 * auth.service.ts, and its verification in security.middleware.ts) --
 * unlike the CSRF mechanism V-14 removed, this one actually has something
 * to verify against.
 */
const isProd = process.env.NODE_ENV === 'production';
const cookieSecurity = {
  secure: isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
};

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    ...cookieSecurity,
    path: '/api',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
}

export function setPlatformTokenCookie(res: Response, token: string): void {
  res.cookie(PLATFORM_TOKEN_COOKIE, token, {
    httpOnly: true,
    ...cookieSecurity,
    path: '/api',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
}

/** Hospital-staff sessions only (mirrors refreshTokens() itself being hospital-only) -- scoped to /api/auth specifically, tighter than the access-token cookie's /api, since only the refresh/logout endpoints ever need to see it. */
export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    ...cookieSecurity,
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

/** Clears all three -- logout doesn't know in advance which mode issued the session, and clearing an absent cookie is a harmless no-op. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/api' });
  res.clearCookie(PLATFORM_TOKEN_COOKIE, { path: '/api' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
}

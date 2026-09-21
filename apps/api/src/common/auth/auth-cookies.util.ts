import { Response } from 'express';

/**
 * Names deliberately distinct per token type (and from the platform token)
 * so a hospital-staff cookie and a platform-admin cookie can never collide
 * or be confused for one another on a browser that's logged into both in
 * different tabs.
 */
export const ACCESS_TOKEN_COOKIE = 'esic_access_token';
export const PLATFORM_TOKEN_COOKIE = 'esic_platform_token';

const ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // matches this app's existing 8h access-token JWT expiry

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
 * `sameSite: 'strict'` is the actual CSRF defense here (not a separate
 * token scheme): the cookie is never sent on any cross-site request at
 * all, including top-level navigation, so a cross-site form/script can
 * never trigger an authenticated action via this cookie the way classic
 * CSRF requires. `secure` is conditional on NODE_ENV because local dev
 * runs over plain HTTP; every real deployment must be HTTPS, where this
 * evaluates true.
 */
export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
}

export function setPlatformTokenCookie(res: Response, token: string): void {
  res.cookie(PLATFORM_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
}

/** Clears both -- logout doesn't know in advance which mode issued the session, and clearing an absent cookie is a harmless no-op. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/api' });
  res.clearCookie(PLATFORM_TOKEN_COOKIE, { path: '/api' });
}

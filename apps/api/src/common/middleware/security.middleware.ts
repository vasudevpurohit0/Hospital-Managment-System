import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET, JWT_PLATFORM_SECRET } from '../config/jwt-secrets';
import { ACCESS_TOKEN_COOKIE, PLATFORM_TOKEN_COOKIE } from '../auth/auth-cookies.util';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Every @Public() mutating route in auth.controller.ts (kept in sync by hand
 * -- there are only five and they change rarely; see the comment on the
 * check below for why this can't just reflect @Public() directly). None of
 * these ever consult the access/platform cookie to authenticate the
 * request, so a CSRF check keyed off that cookie has nothing to protect
 * here -- but without this exemption, a client that happens to be holding a
 * still-valid cookie from an EARLIER session (a second tab, a token that
 * outlived a local logout, simply retrying login after a typo) would get a
 * spurious 403 on these, since none of them have a CSRF token to send yet
 * (that's what they're issuing). Found live-testing A-02 in a real browser,
 * where cookie persistence across attempts is normal, unlike a fresh curl
 * cookie jar per request.
 */
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password-with-token',
  '/api/auth/activate-account',
]);

/**
 * Best-effort, lightweight decode of whichever access-token cookie is
 * present, purely to read the embedded `csrf` claim -- not a substitute for
 * real auth (JwtAuthGuard/PlatformJwtAuthGuard still do the actual
 * verification-plus-DB-reload downstream). Mirrors the same
 * try-one-secret-then-the-other pattern TenantResolutionMiddleware already
 * uses for its own lightweight decode, kept independent here rather than
 * shared since this only needs one field, not the fuller tenant-routing shape.
 */
function decodeCsrfClaim(token: string): string | undefined {
  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as Record<string, unknown>;
    if (typeof payload.csrf === 'string') return payload.csrf;
  } catch {
    // Not a valid hospital-staff access token -- fall through and try the platform secret.
  }
  try {
    const payload = jwt.verify(token, JWT_PLATFORM_SECRET) as Record<string, unknown>;
    if (typeof payload.csrf === 'string') return payload.csrf;
  } catch {
    // Invalid/expired either way -- not this middleware's job to reject that;
    // the real guards produce the actual 401 further down the chain.
  }
  return undefined;
}

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // 2026-09-22 audit: V-14 originally removed a CSRF mechanism here that
    // only checked "some string is present", never that it matched
    // anything real -- safe to remove at the time because auth was
    // Bearer-header-only, and a cross-site request can never forge a custom
    // Authorization header (browsers don't attach arbitrary headers to
    // cross-site requests without an explicit CORS allowance).
    //
    // That assumption no longer fully holds: the access/platform cookies
    // are now SameSite=None in production (required because the frontend
    // and API are on different registrable domains -- see
    // auth-cookies.util.ts), which DOES get attached automatically by the
    // browser on a cross-site request, reopening real CSRF risk for anyone
    // authenticating via the cookie rather than an explicit header. This is
    // a genuine double-submit check: each access token embeds a random
    // `csrf` claim at issuance (auth.service.ts), returned to the client in
    // the login/refresh response body -- never in a cookie, since a cookie
    // set by the API's own origin wouldn't be readable by the frontend's JS
    // anyway (different domain). The frontend echoes it back as
    // X-CSRF-Token on every mutating request. This only applies to
    // cookie-authenticated requests: an explicit Authorization header still
    // needs no CSRF check, for the same reason V-14's removal gave
    // originally, so this is skipped entirely whenever one is present.
    // req.path is relative to wherever Nest mounted this middleware (empty
    // string / "/" here, NOT the real route) -- req.originalUrl is the only
    // field that still carries the actual "/api/..." path at this layer.
    // Query strings never appear on these POST bodies-only auth endpoints,
    // but split defensively anyway rather than assume that stays true.
    const requestPath = req.originalUrl.split('?')[0];
    if (MUTATING_METHODS.has(req.method) && !req.headers['authorization'] && !CSRF_EXEMPT_PATHS.has(requestPath)) {
      const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE] ?? req.cookies?.[PLATFORM_TOKEN_COOKIE];
      if (cookieToken) {
        const csrfClaim = decodeCsrfClaim(cookieToken);
        // No claim at all means either an invalid/expired cookie (the real
        // guard will 401 it shortly) or a token issued before this claim
        // existed -- neither is this middleware's call to make either way.
        if (csrfClaim && req.headers['x-csrf-token'] !== csrfClaim) {
          throw new ForbiddenException('Missing or invalid CSRF token.');
        }
      }
    }

    next();
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * V-14: this used to also issue and "validate" an `X-CSRF-Token` header --
 * except it minted a fresh token on the spot for any request missing one and
 * never bound a previously-issued token to a client (no server-side session/
 * store), so "validation" only ever checked that *some* string was present,
 * or fell back to allowing the request through if an `Authorization` header
 * existed instead. It could not have rejected a real cross-site request; it
 * only created a false sense of a working, compliance-relevant control.
 *
 * Removed rather than implemented properly, per the audit's own reasoning:
 * this API is Bearer-token authenticated, not cookie-based, so a cross-site
 * form/XHR can never automatically attach a valid Authorization header in
 * the first place -- the CSRF threat model genuine token-binding defends
 * against doesn't apply here. If cookie-based auth is ever adopted (see the
 * V-12 recommendation to move refresh tokens to httpOnly cookies), a real
 * double-submit-cookie or session-bound CSRF token would need to be added
 * back at that point, not before.
 */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    next();
  }
}

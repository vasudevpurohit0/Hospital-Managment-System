import { Response } from 'express';

/**
 * R-05 (2026-09-22 audit): these used to be set only inside
 * SecurityMiddleware, registered via `consumer.apply(...).forRoutes('*')` in
 * app.module.ts -- which turned out to be scoped to the app's global prefix
 * (`/api/*`), not every request the Express app receives. Confirmed live,
 * both locally and matching the original finding against production:
 * `GET /api/anything-unmatched` got these headers on its 404; a bare
 * `GET /` (or `/robots.txt`, `/sitemap.xml` -- no `/api` prefix at all) did
 * not, since it never reaches any prefix-scoped middleware in the first
 * place. Low real-world impact (a browser only needs to see HSTS once on a
 * real page load, which every actual endpoint already does), but a genuine
 * inconsistency rather than the "Railway edge proxy" theory this was
 * originally guessed to be.
 *
 * Exported standalone so main.ts can register it as a raw `app.use()`
 * middleware -- unscoped by the global prefix, unlike a NestMiddleware
 * bound through MiddlewareConsumer -- while SecurityMiddleware itself still
 * calls this same function for the `/api/*` case it already covers, so
 * there's exactly one place these headers are defined.
 */
export function applySecurityHeaders(res: Response): void {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

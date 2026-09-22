import * as jwt from 'jsonwebtoken';
import { SecurityMiddleware } from './security.middleware';
import { JWT_ACCESS_SECRET, JWT_PLATFORM_SECRET } from '../config/jwt-secrets';
import { ACCESS_TOKEN_COOKIE, PLATFORM_TOKEN_COOKIE } from '../auth/auth-cookies.util';

/**
 * `originalUrl` is what the middleware actually reads for path-based
 * decisions (the CSRF exemption list) -- `req.path`/`req.url` are relative
 * to wherever Nest mounted this middleware (always "/" in the real app, a
 * bug found live-testing A-02: the exemption list was originally matched
 * against `req.path` and silently never matched anything). Both fields are
 * set here so a mock request shape matches a real Express request.
 */
function mockReq(overrides: Record<string, unknown> & { path: string }): any {
  return { originalUrl: overrides.path, ...overrides };
}

describe('SecurityMiddleware (Phase 15 — Security Hardening)', () => {
  let middleware: SecurityMiddleware;

  beforeEach(() => {
    middleware = new SecurityMiddleware();
  });

  it('should set HSTS, CSP, X-Frame-Options, and X-Content-Type-Options headers on response (FR-SEC-09)', () => {
    const req = mockReq({ method: 'GET', path: '/api/patients/lookup', headers: {} });
    const headers: Record<string, string> = {};
    const res: any = {
      setHeader: (key: string, val: string) => {
        headers[key] = val;
      },
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Content-Security-Policy']).toBe("default-src 'self'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(next).toHaveBeenCalled();
  });

  it('regression (V-14): no longer issues or requires a self-validated X-CSRF-Token on a mutating request with neither an Authorization header nor any CSRF header', () => {
    const req = mockReq({ method: 'POST', path: '/api/patients/register', headers: {} });
    const headers: Record<string, string> = {};
    const res: any = {
      setHeader: (key: string, val: string) => {
        headers[key] = val;
      },
    };
    const next = jest.fn();

    expect(() => middleware.use(req, res, next)).not.toThrow();
    expect(headers['X-CSRF-Token']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  describe('double-submit CSRF check (2026-09-22 audit, replaces the mechanism V-14 removed)', () => {
    const csrf = 'test-csrf-nonce-abc123';
    const cookieToken = jwt.sign({ type: 'access', csrf }, JWT_ACCESS_SECRET, { expiresIn: '1h' });
    const platformCookieToken = jwt.sign({ type: 'platform', csrf }, JWT_PLATFORM_SECRET, { expiresIn: '1h' });

    const runMiddleware = (req: any) => {
      const res: any = { setHeader: () => undefined };
      const next = jest.fn();
      const thrown = (() => {
        try {
          middleware.use(req, res, next);
          return null;
        } catch (err) {
          return err;
        }
      })();
      return { thrown, next };
    };

    it("allows a cookie-authenticated mutating request whose X-CSRF-Token header matches the cookie's embedded claim", () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/patients/register',
        headers: { 'x-csrf-token': csrf },
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it('rejects a cookie-authenticated mutating request with a mismatched X-CSRF-Token header', () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/patients/register',
        headers: { 'x-csrf-token': 'wrong-value' },
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).not.toBeNull();
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a cookie-authenticated mutating request with no X-CSRF-Token header at all', () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/patients/register',
        headers: {},
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).not.toBeNull();
      expect(next).not.toHaveBeenCalled();
    });

    it('checks the platform cookie the same way', () => {
      const req = mockReq({
        method: 'DELETE',
        path: '/api/platform/hospitals/xyz',
        headers: { 'x-csrf-token': 'wrong-value' },
        cookies: { [PLATFORM_TOKEN_COOKIE]: platformCookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).not.toBeNull();
      expect(next).not.toHaveBeenCalled();
    });

    it('skips the check entirely when an Authorization header is present, even with a mismatched/missing CSRF header', () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/patients/register',
        headers: { authorization: 'Bearer some-header-token' },
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it('skips the check for non-mutating (GET) requests regardless of CSRF header', () => {
      const req = mockReq({
        method: 'GET',
        path: '/api/patients/lookup',
        headers: {},
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it('skips the check when there is no auth cookie at all (not a cookie-authenticated request)', () => {
      const req = mockReq({ method: 'POST', path: '/api/auth/login', headers: {}, cookies: {} });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).toBeNull();
      expect(next).toHaveBeenCalled();
    });

    it.each([
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/forgot-password',
      '/api/auth/reset-password-with-token',
      '/api/auth/activate-account',
    ])(
      'never CSRF-blocks the public %s endpoint even when a still-valid cookie from an earlier session is present (found live-testing A-02: a second tab, or simply retrying login, left a valid cookie with no CSRF header to match)',
      (path) => {
        const req = mockReq({
          method: 'POST',
          path,
          headers: {}, // no X-CSRF-Token -- these endpoints never have one to send yet
          cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
        });
        const { thrown, next } = runMiddleware(req);
        expect(thrown).toBeNull();
        expect(next).toHaveBeenCalled();
      },
    );

    it('still enforces the check on a non-exempt /api/auth/* route (logout genuinely relies on the cookie)', () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/auth/logout',
        headers: {},
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      });
      const { thrown, next } = runMiddleware(req);
      expect(thrown).not.toBeNull();
      expect(next).not.toHaveBeenCalled();
    });

    it('matches the exemption list against originalUrl, not path -- req.path is "/" for every request at this middleware layer (real regression: Nest mounts module-level middleware such that req.path/req.url are relative to the mount point, always "/" here, while req.originalUrl keeps the real "/api/..." path)', () => {
      const req: any = {
        method: 'POST',
        path: '/',
        url: '/',
        originalUrl: '/api/auth/login',
        headers: {},
        cookies: { [ACCESS_TOKEN_COOKIE]: cookieToken },
      };
      const { thrown, next } = runMiddleware(req);
      expect(thrown).toBeNull();
      expect(next).toHaveBeenCalled();
    });
  });
});

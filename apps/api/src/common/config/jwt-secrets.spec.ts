describe('jwt-secrets (regression: hardcoded fallback JWT secrets removed)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // The module reads process.env at import time, so each case needs a fresh
  // module instance (jest.isolateModules) after setting up its own env.
  it('throws at import time if JWT_ACCESS_SECRET is missing', () => {
    delete process.env.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'a-real-refresh-secret';
    process.env.JWT_PLATFORM_SECRET = 'a-real-platform-secret';

    expect(() => {
      jest.isolateModules(() => {
        require('./jwt-secrets');
      });
    }).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws if a secret is still the CHANGE_ME_IN_PRODUCTION placeholder from .env.example', () => {
    process.env.JWT_ACCESS_SECRET = 'CHANGE_ME_IN_PRODUCTION';
    process.env.JWT_REFRESH_SECRET = 'a-real-refresh-secret';
    process.env.JWT_PLATFORM_SECRET = 'a-real-platform-secret';

    expect(() => {
      jest.isolateModules(() => {
        require('./jwt-secrets');
      });
    }).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws if JWT_PLATFORM_SECRET is missing, even when the other two are set', () => {
    process.env.JWT_ACCESS_SECRET = 'a-real-access-secret';
    process.env.JWT_REFRESH_SECRET = 'a-real-refresh-secret';
    delete process.env.JWT_PLATFORM_SECRET;

    expect(() => {
      jest.isolateModules(() => {
        require('./jwt-secrets');
      });
    }).toThrow(/JWT_PLATFORM_SECRET/);
  });

  it('loads successfully and exposes the real values when all three are properly set', () => {
    process.env.JWT_ACCESS_SECRET = 'a-real-access-secret';
    process.env.JWT_REFRESH_SECRET = 'a-real-refresh-secret';
    process.env.JWT_PLATFORM_SECRET = 'a-real-platform-secret';

    let loaded: typeof import('./jwt-secrets');
    jest.isolateModules(() => {
      loaded = require('./jwt-secrets');
    });

    expect(loaded!.JWT_ACCESS_SECRET).toBe('a-real-access-secret');
    expect(loaded!.JWT_REFRESH_SECRET).toBe('a-real-refresh-secret');
    expect(loaded!.JWT_PLATFORM_SECRET).toBe('a-real-platform-secret');
  });

  it('never falls back to any hardcoded literal (regression: the exact vulnerability this fix closes)', () => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_PLATFORM_SECRET;

    expect(() => {
      jest.isolateModules(() => {
        require('./jwt-secrets');
      });
    }).toThrow();
    // No assertion can prove a *negative* (no fallback exists) more directly
    // than the fact that this throws instead of returning a usable string --
    // the old code's `|| 'dev_jwt_...'` would have made this call succeed.
  });
});

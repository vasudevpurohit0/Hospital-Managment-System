// Sets fixed, test-only JWT secrets before any test file (and therefore
// before apps/api/src/common/config/jwt-secrets.ts, which every auth-adjacent
// module now imports) is loaded. Without this, the fail-fast validation that
// module performs -- refusing to start if these env vars are missing --
// would throw at import time in a test environment that has never needed to
// set them, since tests previously relied on that module's own hardcoded
// fallback secret working transparently.
//
// Deliberately NOT loaded from the real `.env` file: tests should be
// self-contained and pass in CI, where no `.env` file exists.
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_only_access_secret_never_used_outside_jest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_only_refresh_secret_never_used_outside_jest';
process.env.JWT_PLATFORM_SECRET = process.env.JWT_PLATFORM_SECRET || 'test_only_platform_secret_never_used_outside_jest';

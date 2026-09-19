/**
 * V-03: `enableCors()` with no options reflects and allows any origin. This
 * resolves an explicit allowlist instead, driven by `CORS_ORIGINS` (a
 * comma-separated list, for staging/prod where multiple frontend origins may
 * need access) and falling back to the same `FRONTEND_URL` convention
 * `AuthService`'s activation-link builder already uses, so local dev keeps
 * working with zero extra configuration.
 */
export function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return [process.env.FRONTEND_URL || 'http://localhost:5173'];
}

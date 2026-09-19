import { Logger } from '@nestjs/common';

const logger = new Logger('JwtSecrets');

/** Matches every .env.example's documented placeholder for these three vars. */
const PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION';

/**
 * Every JWT sign/verify call site in this app used to fall back to a
 * hardcoded literal (e.g. `process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345'`)
 * whenever the real environment variable was missing -- silently, with
 * nothing logged, and the app booted and served traffic normally either
 * way. Since that literal is committed in this very source tree, anyone who
 * can read the repository could forge a valid token (including a platform
 * Super Admin token) for any deployment that ever left one of these three
 * variables unset.
 *
 * Reading these once, at module-load time (i.e. at process/app startup,
 * since every call site below imports this module rather than reading
 * `process.env` directly), turns a silent security hole into a startup
 * failure loud enough that it cannot go unnoticed in any environment.
 */
function requireSecret(envVar: string): string {
  const value = process.env[envVar];
  if (!value || value === PLACEHOLDER) {
    const message =
      `${envVar} is not set (or is still the '${PLACEHOLDER}' placeholder from .env.example). ` +
      'Refusing to start rather than silently falling back to a hardcoded, ' +
      'publicly-visible default secret.';
    logger.error(message);
    throw new Error(message);
  }
  return value;
}

export const JWT_ACCESS_SECRET = requireSecret('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET');
export const JWT_PLATFORM_SECRET = requireSecret('JWT_PLATFORM_SECRET');

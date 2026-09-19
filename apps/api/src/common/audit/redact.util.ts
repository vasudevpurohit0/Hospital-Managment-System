/**
 * Field names (case-insensitive substring match) that must never be persisted
 * verbatim into an audit-log snapshot. Several account-lifecycle endpoints
 * (doctor/staff create + reset-password) legitimately return a plaintext
 * temporary password in their HTTP response so an admin can relay it to the
 * new user out-of-band -- but the global AuditInterceptor previously stored
 * that entire response body as-is, turning every such action into a
 * long-lived, durable, plaintext credential leak in the audit trail (readable
 * by anyone with `AuditLog:read`).
 */
const SENSITIVE_FIELD_RE = /password|secret|token|passwordhash|apikey/i;

/**
 * Deep-clones `value`, replacing any object key matching `SENSITIVE_FIELD_RE`
 * with the literal string `'[REDACTED]'`. Applied to both the before- and
 * after-snapshot of every mutating request the audit interceptor captures,
 * not just the endpoints known today to return a credential -- a future
 * endpoint that starts returning/accepting a password/token field is
 * protected by the same denylist without needing its own opt-in.
 */
export function redactSensitiveFields<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_FIELD_RE.test(key) ? '[REDACTED]' : redactSensitiveFields(v);
  }
  return result as T;
}

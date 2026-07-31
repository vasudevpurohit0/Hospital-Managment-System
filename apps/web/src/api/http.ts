/**
 * Shared fetch helper for apps/web/src/api/*.ts modules.
 *
 * Wraps the browser `fetch` API so callers never have to deal with:
 *  - raw network failures (`TypeError: Failed to fetch`) reaching the UI unhandled
 *  - a 2xx response whose body is actually HTML (e.g. a dev-server or proxy
 *    fallback page) blowing up with `SyntaxError: Unexpected token '<'...`
 *  - losing the backend's own error detail (NestJS typically responds with
 *    `{ statusCode, message, error }`, where `message` can be a string or a
 *    string[] from ValidationPipe) in favor of a generic hardcoded message
 */

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** A fallback message, or a function that derives one from the HTTP status code. */
export type FallbackMessage = string | ((status: number) => string);

function resolveFallback(fallbackMessage: FallbackMessage, status: number): string {
  return typeof fallbackMessage === 'function' ? fallbackMessage(status) : fallbackMessage;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.filter((m) => typeof m === 'string').join(', ') || undefined;
  }
  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }
  return undefined;
}

/**
 * Perform a fetch and safely resolve its JSON body, translating every failure
 * mode into a friendly `Error` (or `ApiError`, which carries the HTTP status
 * and parsed body for callers that want it) instead of letting raw
 * `TypeError`/`SyntaxError` messages reach the UI.
 *
 * @param input - same as `fetch`'s first argument
 * @param init - same as `fetch`'s second argument
 * @param fallbackMessage - message to use when the server didn't provide one
 *   of its own; may also be a function of the HTTP status code for endpoints
 *   that want status-specific wording (e.g. 409 vs. other errors).
 */
export async function apiFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackMessage: FallbackMessage = 'Request failed',
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    const fallback = resolveFallback(fallbackMessage, res.status);
    if (isJson) {
      const body = await res.json().catch(() => null);
      throw new ApiError(extractErrorMessage(body) || fallback, res.status, body);
    }
    throw new ApiError(`${fallback} (server returned ${res.status})`, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!isJson) {
    // A 2xx response that isn't JSON (e.g. an HTML fallback page from a
    // misconfigured proxy) is a server-side problem, not a silent success.
    throw new Error(resolveFallback(fallbackMessage, res.status));
  }

  return res.json() as Promise<T>;
}

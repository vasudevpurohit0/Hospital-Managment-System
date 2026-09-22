import { AsyncLocalStorage } from 'async_hooks';

interface RequestLogContext {
  requestId: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestLogContext>();

/** Returns the current request's correlation ID, or undefined outside any request (a cron job, app bootstrap). */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

import { ConflictException, ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { method: 'POST', originalUrl: '/api/charges/service', headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeHandler(response: unknown, shouldError = false): CallHandler {
  return {
    handle: () => (shouldError ? throwError(() => new Error('boom')) : of(response)),
  };
}

describe('IdempotencyInterceptor (V-18)', () => {
  beforeEach(() => {
    IdempotencyInterceptor.resetCacheForTests();
  });

  it('passes a request through untouched when no Idempotency-Key header is present', (done) => {
    const interceptor = new IdempotencyInterceptor();
    const result$ = interceptor.intercept(makeContext(), makeHandler({ id: 'charge-1' }));
    result$.subscribe((value) => {
      expect(value).toEqual({ id: 'charge-1' });
      done();
    });
  });

  it('returns the cached response for a repeat request with the same key after the first completes', (done) => {
    const interceptor = new IdempotencyInterceptor();
    const ctx = makeContext({ 'idempotency-key': 'key-1' });

    interceptor.intercept(ctx, makeHandler({ id: 'charge-1' })).subscribe(() => {
      interceptor.intercept(ctx, makeHandler({ id: 'charge-2' })).subscribe((value) => {
        // Still 'charge-1' -- the second handler's response ({ id: 'charge-2' }) was never used.
        expect(value).toEqual({ id: 'charge-1' });
        done();
      });
    });
  });

  it('rejects a concurrent repeat with the same key while the first request is still in flight', () => {
    const interceptor = new IdempotencyInterceptor();
    const ctx = makeContext({ 'idempotency-key': 'key-2' });

    // First call never completes (handler not subscribed), leaving the entry 'in-flight'.
    interceptor.intercept(ctx, makeHandler({ id: 'charge-1' }));

    expect(() => interceptor.intercept(ctx, makeHandler({ id: 'charge-2' }))).toThrow(ConflictException);
  });

  it('allows a fresh retry with the same key after a failed attempt', (done) => {
    const interceptor = new IdempotencyInterceptor();
    const ctx = makeContext({ 'idempotency-key': 'key-3' });

    interceptor.intercept(ctx, makeHandler(undefined, true)).subscribe({
      error: () => {
        interceptor.intercept(ctx, makeHandler({ id: 'charge-1' })).subscribe((value) => {
          expect(value).toEqual({ id: 'charge-1' });
          done();
        });
      },
    });
  });

  it('does not conflate the same key across two different routes', (done) => {
    const interceptor = new IdempotencyInterceptor();
    const ctxA = makeContext({ 'idempotency-key': 'shared-key' });
    const requestB = { method: 'POST', originalUrl: '/api/receipts', headers: { 'idempotency-key': 'shared-key' } };
    const ctxB = { switchToHttp: () => ({ getRequest: () => requestB }) } as unknown as ExecutionContext;

    interceptor.intercept(ctxA, makeHandler({ id: 'charge-1' })).subscribe(() => {
      interceptor.intercept(ctxB, makeHandler({ id: 'receipt-1' })).subscribe((value) => {
        expect(value).toEqual({ id: 'receipt-1' });
        done();
      });
    });
  });
});

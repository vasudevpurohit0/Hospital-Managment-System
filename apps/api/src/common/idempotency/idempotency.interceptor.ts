import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

interface CacheEntry {
  status: 'in-flight' | 'done';
  response?: unknown;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

/**
 * V-18: `ChargeService.postServiceCharge`/`postPharmacyCharge` have no
 * dedup protection against a double-click or client retry firing the same
 * creation request twice -- each call posts its own separate PENDING charge.
 * Applied via `@UseInterceptors(IdempotencyInterceptor)` on a route, this
 * caches the response for a client-supplied `Idempotency-Key` header for a
 * few minutes, so a repeat of the same key on the same route returns the
 * original result instead of creating a duplicate. Opt-in: a request with no
 * key gets no protection, same as before this existed. A concurrent repeat
 * (the original request still in flight) is rejected with 409 rather than
 * silently duplicated or blocked.
 *
 * In-memory, single-process only -- fine for this app's current single-
 * instance deployment. Move to a shared store (Redis, already in this
 * stack) if/when the API ever runs more than one instance.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private static readonly cache = new Map<string, CacheEntry>();

  /** Test-only: the cache is process-wide (static) by design, so specs need a way to reset it between cases. */
  static resetCacheForTests(): void {
    IdempotencyInterceptor.cache.clear();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') {
      return next.handle();
    }

    this.evictExpired();
    const cacheKey = `${request.method} ${request.originalUrl ?? request.url}::${key}`;
    const existing = IdempotencyInterceptor.cache.get(cacheKey);

    if (existing) {
      if (existing.status === 'in-flight') {
        throw new ConflictException('A request with this Idempotency-Key is already in progress.');
      }
      return of(existing.response);
    }

    IdempotencyInterceptor.cache.set(cacheKey, { status: 'in-flight', expiresAt: Date.now() + TTL_MS });

    return next.handle().pipe(
      tap({
        next: (response) => {
          IdempotencyInterceptor.cache.set(cacheKey, { status: 'done', response, expiresAt: Date.now() + TTL_MS });
        },
        error: () => {
          // A failed attempt should not permanently block a retry with the same key.
          IdempotencyInterceptor.cache.delete(cacheKey);
        },
      }),
    );
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of IdempotencyInterceptor.cache) {
      if (entry.expiresAt < now) IdempotencyInterceptor.cache.delete(key);
    }
  }
}

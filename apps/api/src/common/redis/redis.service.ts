import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin cache-only wrapper around ioredis. Every public method swallows its
 * own errors and degrades to a no-op (`null` on read, silently skipped on
 * write) rather than throwing -- callers use this exclusively for the
 * cache-aside pattern (see CacheKeys/*.service.ts), where the database is
 * always the source of truth and Redis is a pure optimization. A Redis
 * outage must never turn into an application outage: every caller of this
 * service already has a database fallback path for a cache miss, and a
 * cache miss is exactly what a Redis error produces here.
 *
 * REDIS_URL is optional for the same reason -- unlike DATABASE_URL, nothing
 * about this app's correctness depends on Redis being configured at all.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private ready = false;

  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set -- caching disabled, all reads will fall back to the database.');
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
      reconnectOnError: () => true,
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('Redis connection ready.');
    });
    this.client.on('error', (err) => {
      this.ready = false;
      // Never log the connection URL (may carry credentials) -- just the error message.
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.client.on('close', () => {
      this.ready = false;
      this.logger.warn('Redis connection closed.');
    });
    this.client.on('reconnecting', () => {
      this.logger.warn('Redis reconnecting...');
    });
  }

  async onModuleDestroy(): Promise<void> {
    // `disconnect()` (not `quit()`) on purpose: this is a cache-only client
    // with no in-flight writes worth waiting on at shutdown, and `quit()`'s
    // graceful close can leave a pending reconnect timer alive when the
    // connection was already flapping (e.g. host unreachable), which then
    // leaks past process exit in tests. `disconnect()` is synchronous and
    // immediately cancels any pending reconnect attempt.
    this.client?.disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client || !this.ready) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Redis GET failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.ready) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed for key "${key}": ${(err as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client || !this.ready || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(`Redis DEL failed for key(s) "${keys.join(', ')}": ${(err as Error).message}`);
    }
  }
}

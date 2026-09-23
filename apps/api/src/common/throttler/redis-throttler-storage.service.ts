import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

// Not re-exported from '@nestjs/throttler''s public index (only the
// ThrottlerStorage interface/token is) -- mirrored locally rather than
// deep-importing an internal dist path.
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Atomically increments the hit counter and, once it exceeds `limit`, sets
 * a separate "blocked" flag with its own TTL (`blockDuration`) -- mirrors
 * @nestjs/throttler's own in-memory algorithm (throttler.service.js) so
 * switching storage backends doesn't change rate-limiting behavior. Both
 * keys share a `{...}` hash tag so this script stays cluster-safe even
 * though this deployment only ever runs single-node Redis today.
 *
 * KEYS[1] = hits key, KEYS[2] = blocked key
 * ARGV[1] = ttl (ms), ARGV[2] = limit, ARGV[3] = blockDuration (ms)
 * returns: [totalHits, timeToExpireMs, isBlocked(0|1), timeToBlockExpireMs]
 */
const INCREMENT_SCRIPT = `
local blockPttl = redis.call('PTTL', KEYS[2])
if blockPttl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1])) or 0
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {hits, ttl, 1, blockPttl}
end

local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end

local isBlocked = 0
local blockTtl = 0
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], 1, 'PX', ARGV[3])
  isBlocked = 1
  blockTtl = tonumber(ARGV[3])
end

return {hits, ttl, isBlocked, blockTtl}
`;

/**
 * Redis-backed ThrottlerStorage, closing the "Rate limiting via Redis" PARTIAL
 * from the 2026-09-22 verification pass: @nestjs/throttler defaults to
 * in-memory storage, which is per-process and would let each instance of a
 * horizontally-scaled deployment enforce its own independent budget instead
 * of one shared ceiling. This makes the counter shared across instances via
 * Redis while never turning a Redis outage into a rate-limiting outage --
 * REDIS_URL unset, or the connection down, falls back to the library's own
 * in-memory ThrottlerStorageService (today's exact behavior), the same
 * fail-safe philosophy RedisService already uses for caching.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private client: Redis | null = null;
  private ready = false;
  private readonly fallback = new ThrottlerStorageService();

  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set -- rate limiting falls back to in-memory storage (fine for a single instance).');
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
      this.logger.log('Redis throttler storage ready.');
    });
    this.client.on('error', (err) => {
      this.ready = false;
      this.logger.error(`Redis throttler storage error: ${err.message}`);
    });
    this.client.on('close', () => {
      this.ready = false;
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.disconnect();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.client || !this.ready) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    try {
      const hitsKey = `throttle:{${key}}:${throttlerName}:hits`;
      const blockedKey = `throttle:{${key}}:${throttlerName}:blocked`;
      const [totalHits, timeToExpireMs, isBlockedRaw, timeToBlockExpireMs] = (await this.client.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        blockedKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

      return {
        totalHits,
        timeToExpire: Math.ceil(timeToExpireMs / 1000),
        isBlocked: isBlockedRaw === 1,
        timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
      };
    } catch (err) {
      this.logger.warn(
        `Redis throttler increment failed, falling back to in-memory storage for this request: ${(err as Error).message}`,
      );
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}

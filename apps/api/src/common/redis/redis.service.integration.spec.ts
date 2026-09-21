import { RedisService } from './redis.service';

/**
 * Real integration test against a live Redis -- no mocking of `ioredis`
 * anywhere in this file (unlike redis.service.spec.ts). Requires the
 * project's own `esic-hms-redis` docker-compose service (or any Redis
 * reachable at REDIS_URL, default redis://localhost:6379 to match that
 * service's published port). Skips itself (with a console warning, not a
 * failure) if no Redis is reachable, so this suite doesn't break a checkout
 * that hasn't run `docker compose up`.
 */
describe('RedisService (real Redis integration)', () => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  let service: RedisService;
  let redisReachable = false;

  beforeAll(async () => {
    process.env.REDIS_URL = url;
    service = new RedisService();
    service.onModuleInit();
    // Give the real TCP connection a moment to establish before the first ping.
    await new Promise((resolve) => setTimeout(resolve, 300));
    redisReachable = await service.ping();
    if (!redisReachable) {
      // eslint-disable-next-line no-console
      console.warn(`[redis.service.integration.spec] No Redis reachable at ${url} -- skipping real-Redis assertions.`);
    }
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('connects and responds to PING', () => {
    if (!redisReachable) return;
    expect(redisReachable).toBe(true);
    expect(service.isReady()).toBe(true);
  });

  it('SET -> GET -> DELETE round-trip against the real server', async () => {
    if (!redisReachable) return;
    const key = `hms:test:integration:${Date.now()}`;
    const value = { hospitalId: 'test-hospital', items: [1, 2, 3] };

    expect(await service.getJson(key)).toBeNull();

    await service.setJson(key, value, 30);
    expect(await service.getJson(key)).toEqual(value);

    await service.del(key);
    expect(await service.getJson(key)).toBeNull();
  });

  it('a value written with a short TTL actually expires', async () => {
    if (!redisReachable) return;
    const key = `hms:test:ttl:${Date.now()}`;
    await service.setJson(key, { x: 1 }, 1);
    expect(await service.getJson(key)).toEqual({ x: 1 });

    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await service.getJson(key)).toBeNull();
  });

  it('two different tenant-scoped keys never collide', async () => {
    if (!redisReachable) return;
    const keyA = 'hms:test:hospital-a:departments';
    const keyB = 'hms:test:hospital-b:departments';
    await service.setJson(keyA, [{ name: 'Cardiology (A)' }], 30);
    await service.setJson(keyB, [{ name: 'Cardiology (B)' }], 30);

    expect(await service.getJson(keyA)).toEqual([{ name: 'Cardiology (A)' }]);
    expect(await service.getJson(keyB)).toEqual([{ name: 'Cardiology (B)' }]);

    await service.del(keyA, keyB);
  });

  it('reports not-ready and falls back to null reads when pointed at an unreachable host', async () => {
    const bogus = new RedisService();
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    bogus.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bogus.isReady()).toBe(false);
    expect(await bogus.getJson('anything')).toBeNull();
    await expect(bogus.setJson('anything', { a: 1 }, 10)).resolves.toBeUndefined();
    await bogus.onModuleDestroy();

    process.env.REDIS_URL = url;
  }, 10000);
});

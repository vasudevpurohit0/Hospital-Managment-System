import { RedisThrottlerStorage } from './redis-throttler-storage.service';

const mockClient = {
  eval: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockClient));

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    storage = new RedisThrottlerStorage();
  });

  function goReady() {
    storage.onModuleInit();
    const readyHandler = mockClient.on.mock.calls.find(([event]) => event === 'ready')?.[1];
    readyHandler?.();
  }

  it('falls back to in-memory storage (no client call) when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const s = new RedisThrottlerStorage();
    s.onModuleInit();

    // Short ttl/blockDuration (not 60_000) so the fallback's internal
    // setTimeout doesn't hold the test process open.
    const first = await s.increment('k', 50, 2, 50, 'default');
    // timeToBlockExpire is meaningless while isBlocked is false -- the
    // library's own in-memory ThrottlerStorageService returns a large
    // negative number for it in that case (blockExpiresAt defaults to 0),
    // so only isBlocked/totalHits are asserted precisely here.
    expect(first).toEqual(
      expect.objectContaining({ totalHits: 1, timeToExpire: expect.any(Number), isBlocked: false }),
    );
    expect(mockClient.eval).not.toHaveBeenCalled();
  });

  it('falls back to in-memory storage when the client has not emitted "ready" yet', async () => {
    storage.onModuleInit(); // no 'ready' emitted
    await storage.increment('k', 50, 2, 50, 'default');
    expect(mockClient.eval).not.toHaveBeenCalled();
  });

  it('uses the Redis EVAL script once ready, and maps its reply onto ThrottlerStorageRecord', async () => {
    goReady();
    mockClient.eval.mockResolvedValueOnce([3, 45_000, 0, 0]);

    const result = await storage.increment('user-1', 60_000, 10, 60_000, 'default');

    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'throttle:{user-1}:default:hits',
      'throttle:{user-1}:default:blocked',
      60_000,
      10,
      60_000,
    );
    expect(result).toEqual({ totalHits: 3, timeToExpire: 45, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('reports isBlocked true and the block TTL once the script signals it', async () => {
    goReady();
    mockClient.eval.mockResolvedValueOnce([11, 12_000, 1, 60_000]);

    const result = await storage.increment('user-1', 60_000, 10, 60_000, 'default');

    expect(result).toEqual({ totalHits: 11, timeToExpire: 12, isBlocked: true, timeToBlockExpire: 60 });
  });

  it('falls back to in-memory storage for this request when EVAL rejects, without throwing', async () => {
    goReady();
    mockClient.eval.mockRejectedValueOnce(new Error('READONLY'));

    await expect(storage.increment('user-1', 50, 10, 50, 'default')).resolves.toEqual(
      expect.objectContaining({ totalHits: 1, isBlocked: false }),
    );
  });

  it('flips back to not-ready on an "error" or "close" event and then falls back to in-memory', async () => {
    goReady();
    const errorHandler = mockClient.on.mock.calls.find(([event]) => event === 'error')?.[1];
    errorHandler?.(new Error('ECONNREFUSED'));

    await storage.increment('user-1', 50, 10, 50, 'default');
    expect(mockClient.eval).not.toHaveBeenCalled();
  });

  it('onModuleDestroy disconnects the client', async () => {
    goReady();
    await expect(storage.onModuleDestroy()).resolves.toBeUndefined();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});

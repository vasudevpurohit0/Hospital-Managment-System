import { RedisService } from './redis.service';

const mockClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockClient));

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    service = new RedisService();
  });

  function goReady() {
    service.onModuleInit();
    const readyHandler = mockClient.on.mock.calls.find(([event]) => event === 'ready')?.[1];
    readyHandler?.();
  }

  it('does not construct a client and stays not-ready when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;
    const svc = new RedisService();
    svc.onModuleInit();
    expect(svc.isReady()).toBe(false);
  });

  it('becomes ready once the client emits "ready"', () => {
    goReady();
    expect(service.isReady()).toBe(true);
  });

  it('flips back to not-ready on an "error" event and logs without throwing', () => {
    goReady();
    const errorHandler = mockClient.on.mock.calls.find(([event]) => event === 'error')?.[1];
    expect(() => errorHandler?.(new Error('ECONNREFUSED'))).not.toThrow();
    expect(service.isReady()).toBe(false);
  });

  it('flips back to not-ready on a "close" event', () => {
    goReady();
    const closeHandler = mockClient.on.mock.calls.find(([event]) => event === 'close')?.[1];
    closeHandler?.();
    expect(service.isReady()).toBe(false);
  });

  it('getJson returns null (not throw) when not ready, without ever calling the client', async () => {
    service.onModuleInit(); // no 'ready' emitted
    const result = await service.getJson('some-key');
    expect(result).toBeNull();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it('getJson parses a hit and returns null on a miss', async () => {
    goReady();
    mockClient.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
    await expect(service.getJson('k')).resolves.toEqual({ a: 1 });

    mockClient.get.mockResolvedValueOnce(null);
    await expect(service.getJson('k')).resolves.toBeNull();
  });

  it('getJson swallows a client error and returns null rather than throwing', async () => {
    goReady();
    mockClient.get.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.getJson('k')).resolves.toBeNull();
  });

  it('setJson writes with EX ttl and swallows errors', async () => {
    goReady();
    await service.setJson('k', { a: 1 }, 60);
    expect(mockClient.set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), 'EX', 60);

    mockClient.set.mockRejectedValueOnce(new Error('down'));
    await expect(service.setJson('k', { a: 1 }, 60)).resolves.toBeUndefined();
  });

  it('setJson is a no-op (does not call the client) when not ready', async () => {
    service.onModuleInit();
    await service.setJson('k', { a: 1 }, 60);
    expect(mockClient.set).not.toHaveBeenCalled();
  });

  it('del calls the client with all keys and swallows errors', async () => {
    goReady();
    await service.del('k1', 'k2');
    expect(mockClient.del).toHaveBeenCalledWith('k1', 'k2');

    mockClient.del.mockRejectedValueOnce(new Error('down'));
    await expect(service.del('k1')).resolves.toBeUndefined();
  });

  it('del with no keys is a no-op', async () => {
    goReady();
    await service.del();
    expect(mockClient.del).not.toHaveBeenCalled();
  });

  it('ping returns true on PONG and false on any failure', async () => {
    goReady();
    mockClient.ping.mockResolvedValueOnce('PONG');
    await expect(service.ping()).resolves.toBe(true);

    mockClient.ping.mockRejectedValueOnce(new Error('down'));
    await expect(service.ping()).resolves.toBe(false);
  });

  it('ping returns false when no client was ever constructed', async () => {
    delete process.env.REDIS_URL;
    const svc = new RedisService();
    svc.onModuleInit();
    await expect(svc.ping()).resolves.toBe(false);
  });

  it('onModuleDestroy disconnects the client', async () => {
    goReady();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});

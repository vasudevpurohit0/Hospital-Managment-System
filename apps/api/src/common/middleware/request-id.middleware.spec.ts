import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  function run(headers: Record<string, string> = {}) {
    const req: any = { headers };
    const res: any = { setHeader: jest.fn() };
    const next = jest.fn();
    middleware.use(req, res, next);
    return { req, res, next };
  }

  it('mints a fresh UUID and echoes it on the response header when no incoming id is present', () => {
    const { req, res, next } = run();
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses an upstream-supplied x-request-id instead of minting a new one', () => {
    const { req, res } = run({ 'x-request-id': 'upstream-trace-abc123' });
    expect(req.id).toBe('upstream-trace-abc123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'upstream-trace-abc123');
  });

  it('ignores a whitespace-only incoming header and mints its own id instead', () => {
    const { req } = run({ 'x-request-id': '   ' });
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('generates a different id for two separate requests with no incoming header', () => {
    const { req: reqA } = run();
    const { req: reqB } = run();
    expect(reqA.id).not.toEqual(reqB.id);
  });
});

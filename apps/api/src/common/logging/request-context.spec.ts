import { requestContextStorage, getRequestId } from './request-context';

describe('request-context', () => {
  it('getRequestId returns undefined outside any run() scope', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('getRequestId returns the id set for the current run() scope', () => {
    requestContextStorage.run({ requestId: 'abc-123' }, () => {
      expect(getRequestId()).toBe('abc-123');
    });
  });

  it('nested/concurrent async contexts do not leak into each other', async () => {
    const results: (string | undefined)[] = [];
    await Promise.all([
      requestContextStorage.run({ requestId: 'req-1' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getRequestId());
      }),
      requestContextStorage.run({ requestId: 'req-2' }, async () => {
        results.push(getRequestId());
      }),
    ]);
    expect(results.sort()).toEqual(['req-1', 'req-2']);
  });
});

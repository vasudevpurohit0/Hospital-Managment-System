import { UserAwareThrottlerGuard } from './user-aware-throttler.guard';

describe('UserAwareThrottlerGuard', () => {
  // Access the protected method via a typed cast -- this is what
  // ThrottlerGuard.canActivate() itself calls internally.
  function tracker(guard: UserAwareThrottlerGuard) {
    return (guard as unknown as { getTracker(req: Record<string, any>): Promise<string> }).getTracker.bind(guard);
  }

  function makeGuard(): UserAwareThrottlerGuard {
    // ThrottlerGuard's constructor needs options/storage/reflector, but
    // getTracker() never touches them -- a bare instance is enough to test
    // the one method this class overrides.
    return Object.create(UserAwareThrottlerGuard.prototype);
  }

  it('keys by the authenticated user id when req.user is present', async () => {
    const guard = makeGuard();
    const req = { user: { id: 'user-123' }, ip: '10.0.0.5' };
    await expect(tracker(guard)(req)).resolves.toBe('user:user-123');
  });

  it('falls back to the base IP-tracking behavior when there is no authenticated user', async () => {
    const guard = makeGuard();
    const req = { ips: [], ip: '10.0.0.9' };
    await expect(tracker(guard)(req)).resolves.toBe('10.0.0.9');
  });

  it('two different authenticated users behind the same IP get two different tracker keys', async () => {
    const guard = makeGuard();
    const reqA = { user: { id: 'doctor-a' }, ip: '10.0.0.1' };
    const reqB = { user: { id: 'receptionist-b' }, ip: '10.0.0.1' };

    const keyA = await tracker(guard)(reqA);
    const keyB = await tracker(guard)(reqB);

    expect(keyA).not.toEqual(keyB);
  });
});

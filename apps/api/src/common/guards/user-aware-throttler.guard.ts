import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Default @nestjs/throttler tracks solely by source IP. Fine for the
 * pre-auth routes it exists to protect (login, forgot-password), but wrong
 * for every authenticated, per-user-scoped @Throttle() in this app (billing
 * charge posting, lab actions, PDF/report generation): a real hospital's
 * whole staff typically sits behind one NAT gateway, so IP-based tracking
 * would let one busy receptionist's report exports exhaust the same budget
 * a doctor down the hall needs for something unrelated -- throttling
 * legitimate hospital workflows exactly as this app's own Phase-17 rule
 * warns against.
 *
 * Falls back to IP when there's no authenticated user yet (any @Public()
 * route, or a request that will shortly be rejected by JwtAuthGuard
 * anyway) -- unauthenticated brute-force protection still needs an IP-based
 * bucket, since there's no user identity to key on.
 *
 * Requires JwtAuthGuard to run BEFORE this guard in APP_GUARD registration
 * order (see app.module.ts) so `req.user` is already populated by the time
 * getTracker() runs.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id;
    if (userId) return `user:${userId}`;
    return super.getTracker(req);
  }
}

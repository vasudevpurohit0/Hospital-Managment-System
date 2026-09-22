import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { RedisService } from '../common/redis/redis.service';

/**
 * Health check controller for the ESIC HMS API.
 *
 * Provides a lightweight unauthenticated endpoint for infrastructure monitoring,
 * load balancer health probes, and Docker Compose healthchecks.
 *
 * Route: GET /api/health
 */
@Controller('health')
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  /**
   * Returns the current health status of the API service.
   *
   * @returns Health status payload with metadata
   */
  // Load balancers/Docker healthchecks poll this frequently from a fixed
  // address -- rate-limiting it would eventually make infrastructure
  // monitoring indistinguishable from an outage.
  @Public()
  @SkipThrottle()
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): {
    status: string;
    timestamp: string;
    uptime: number;
    version: string;
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  /**
   * Separate from the liveness probe above on purpose: Redis is a pure
   * cache-aside optimization (see RedisService), never a correctness
   * dependency, so a Redis outage must never fail the primary `/health`
   * endpoint a load balancer or Docker healthcheck restarts the container
   * over. This route is for humans/dashboards checking dependency status,
   * not for anything that gates traffic or restarts.
   */
  @Public()
  @SkipThrottle()
  @Get('dependencies')
  @HttpCode(HttpStatus.OK)
  async dependencies(): Promise<{ redis: 'up' | 'down' }> {
    const redisUp = await this.redis.ping();
    return { redis: redisUp ? 'up' : 'down' };
  }
}

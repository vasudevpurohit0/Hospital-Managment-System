import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health module — provides GET /api/health (pure liveness, no dependency
 * checks -- see the comment on HealthController.dependencies() for why) and
 * GET /api/health/dependencies (Redis connectivity, for dashboards/humans).
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

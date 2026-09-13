import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService, DateRange } from './analytics.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

function parseRange(from?: string, to?: string): DateRange {
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
}

/** Feature 12 — comprehensive admin analytics, every number a live query (Feature 22). */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('operations')
  @RequirePermission('Analytics', 'read')
  async operations(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.operations(parseRange(from, to));
  }

  @Get('clinical')
  @RequirePermission('Analytics', 'read')
  async clinical(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.clinical(parseRange(from, to));
  }

  @Get('financial')
  @RequirePermission('Analytics', 'read')
  async financial(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.financial(parseRange(from, to));
  }

  @Get('inventory')
  @RequirePermission('Analytics', 'read')
  async inventory() {
    return this.analytics.inventory();
  }
}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';

@Controller('platform/dashboard')
@UseGuards(PlatformOnlyGuard)
export class PlatformDashboardController {
  constructor(private readonly dashboard: PlatformDashboardService) {}

  @Get('summary')
  async getSummary() {
    return this.dashboard.getSummary();
  }
}

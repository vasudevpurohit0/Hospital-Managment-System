import { Module } from '@nestjs/common';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { PlatformAdminsController } from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  controllers: [HospitalsController, PlatformAdminsController, PlatformAuditLogController, PlatformDashboardController],
  providers: [HospitalsService, PlatformAdminsService, PlatformDashboardService],
})
export class PlatformModule {}

import { Module } from '@nestjs/common';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { HospitalAdminsController } from './hospital-admins.controller';
import { HospitalAdminsService } from './hospital-admins.service';
import { PlatformAdminsController } from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  controllers: [
    HospitalsController,
    HospitalAdminsController,
    PlatformAdminsController,
    PlatformAuditLogController,
    PlatformDashboardController,
  ],
  providers: [HospitalsService, HospitalAdminsService, PlatformAdminsService, PlatformDashboardService],
})
export class PlatformModule {}

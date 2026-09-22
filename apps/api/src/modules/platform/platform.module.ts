import { Module } from '@nestjs/common';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { HospitalAdminsController } from './hospital-admins.controller';
import { HospitalAdminsService } from './hospital-admins.service';
import { PlatformAdminsController } from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformAuditLogController } from './platform-audit-log.controller';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformStaffAuditController } from './platform-staff-audit.controller';
import { PlatformStaffAuditService } from './platform-staff-audit.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DashboardModule, AuditLogModule, AuthModule],
  controllers: [
    HospitalsController,
    HospitalAdminsController,
    PlatformAdminsController,
    PlatformAuditLogController,
    PlatformDashboardController,
    PlatformStaffAuditController,
  ],
  providers: [
    HospitalsService,
    HospitalAdminsService,
    PlatformAdminsService,
    PlatformAuditLogService,
    PlatformDashboardService,
    PlatformStaffAuditService,
  ],
})
export class PlatformModule {}

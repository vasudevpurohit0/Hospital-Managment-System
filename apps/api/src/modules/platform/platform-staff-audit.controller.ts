import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformStaffAuditService } from './platform-staff-audit.service';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';

/**
 * Cross-hospital staff Activity Log for Super Admin -- distinct from
 * PlatformAuditLogController (/platform/audit-log), which logs a different
 * thing: Super Admin's own cross-hospital *access* events, not staff
 * actions. This one reads each hospital's tenant AuditLog table.
 */
@Controller('platform/staff-audit-log')
@UseGuards(PlatformOnlyGuard)
export class PlatformStaffAuditController {
  constructor(private readonly platformStaffAuditService: PlatformStaffAuditService) {}

  @Get()
  async findAll(
    @Query('hospitalId') hospitalId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platformStaffAuditService.getStaffAuditLog({
      hospitalId,
      actorUserId,
      action,
      entityType,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}

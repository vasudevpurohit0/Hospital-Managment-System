import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuditStatus, AuditSeverity } from '@prisma/client';
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
    @Query('status') status?: AuditStatus,
    @Query('severity') severity?: AuditSeverity,
    @Query('q') q?: string,
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
      status,
      severity,
      q,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  async getStats(@Query('hospitalId') hospitalId?: string) {
    return this.platformStaffAuditService.getStats({ hospitalId });
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('hospitalId') hospitalId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('status') status?: AuditStatus,
    @Query('severity') severity?: AuditSeverity,
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const csv = await this.platformStaffAuditService.exportCsv({
      hospitalId,
      actorUserId,
      action,
      entityType,
      status,
      severity,
      q,
      dateFrom,
      dateTo,
    });
    res.setHeader('Content-Disposition', 'attachment; filename="staff-activity-log.csv"');
    res.send(csv);
  }
}

import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuditLogService } from './audit-log.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

/**
 * Hospital-scoped Activity Log -- always the caller's own tenant (tenant
 * isolation is structural: TenantResolutionMiddleware resolves the schema
 * from the JWT alone for a hospital token, so this controller never needs to
 * check a hospital id itself). Cross-hospital viewing is a separate,
 * platform-only endpoint (see platform-staff-audit.controller.ts).
 */
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermission('AuditLog', 'read')
  async findAll(
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditLogService.findAll({
      actorUserId,
      action,
      entityType,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('export.csv')
  @RequirePermission('AuditLog', 'read')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const csv = await this.auditLogService.exportCsv({ actorUserId, action, entityType, dateFrom, dateTo });
    res.setHeader('Content-Disposition', 'attachment; filename="activity-log.csv"');
    res.send(csv);
  }
}

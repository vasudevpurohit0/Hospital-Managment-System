import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformOnlyGuard } from '../../common/guards/platform-only.guard';

@Controller('platform/audit-log')
@UseGuards(PlatformOnlyGuard)
export class PlatformAuditLogController {
  constructor(private readonly platformAuditLogService: PlatformAuditLogService) {}

  @Get()
  async findAll(
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platformAuditLogService.findAll({
      q,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  async getStats() {
    return this.platformAuditLogService.getStats();
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const csv = await this.platformAuditLogService.exportCsv({ q, dateFrom, dateTo });
    res.setHeader('Content-Disposition', 'attachment; filename="platform-audit-log.csv"');
    res.send(csv);
  }
}

import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

function parseRange(from?: string, to?: string) {
  return { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined };
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('billing.csv')
  @RequirePermission('Report', 'generate')
  @Header('Content-Type', 'text/csv')
  async billingCsv(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response) {
    const csv = await this.reports.billingReportCsv(parseRange(from, to));
    sendCsv(res, 'billing-report.csv', csv);
  }

  @Get('outstanding.csv')
  @RequirePermission('Report', 'generate')
  @Header('Content-Type', 'text/csv')
  async outstandingCsv(@Res() res: Response) {
    const csv = await this.reports.outstandingReportCsv();
    sendCsv(res, 'outstanding-report.csv', csv);
  }

  @Get('patient-register.csv')
  @RequirePermission('Report', 'generate')
  @Header('Content-Type', 'text/csv')
  async patientRegisterCsv(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.reports.patientRegisterCsv(parseRange(from, to));
    sendCsv(res, 'patient-register.csv', csv);
  }
}

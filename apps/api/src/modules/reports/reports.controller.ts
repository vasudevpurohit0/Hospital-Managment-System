import { BadRequestException, Controller, Get, Header, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

/**
 * Rejects an invalid or reversed date range instead of silently passing
 * `Invalid Date` through to Prisma (which previously matched nothing, with
 * no indication to the caller why their report came back empty).
 */
function parseRange(from?: string, to?: string) {
  const parsedFrom = from ? new Date(from) : undefined;
  const parsedTo = to ? new Date(to) : undefined;
  if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
    throw new BadRequestException(`Invalid "from" date: "${from}".`);
  }
  if (parsedTo && Number.isNaN(parsedTo.getTime())) {
    throw new BadRequestException(`Invalid "to" date: "${to}".`);
  }
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    throw new BadRequestException('"from" date must not be after "to" date.');
  }
  return { from: parsedFrom, to: parsedTo };
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // V-04: report generation is expensive (full-table query + CSV render) --
  // an uncapped caller could otherwise repeat these on every request for a
  // cheap DoS/cost-amplification vector even with the row cap from the
  // unbounded-export fix already in place.
  @Get('billing.csv')
  @RequirePermission('Report', 'generate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv')
  async billingCsv(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response) {
    const csv = await this.reports.billingReportCsv(parseRange(from, to));
    sendCsv(res, 'billing-report.csv', csv);
  }

  @Get('outstanding.csv')
  @RequirePermission('Report', 'generate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv')
  async outstandingCsv(@Res() res: Response) {
    const csv = await this.reports.outstandingReportCsv();
    sendCsv(res, 'outstanding-report.csv', csv);
  }

  @Get('patient-register.csv')
  @RequirePermission('Report', 'generate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

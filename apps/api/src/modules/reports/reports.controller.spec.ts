import { BadRequestException } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController date-range validation (regression: invalid/reversed dates silently passed through)', () => {
  let controller: ReportsController;
  const mockReports = { billingReportCsv: jest.fn().mockResolvedValue('csv-data') };
  const mockRes = { setHeader: jest.fn(), send: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ReportsController(mockReports as unknown as ReportsService);
  });

  it('rejects an unparsable "from" date', async () => {
    await expect(controller.billingCsv('not-a-date', undefined, mockRes)).rejects.toThrow(BadRequestException);
    expect(mockReports.billingReportCsv).not.toHaveBeenCalled();
  });

  it('rejects an unparsable "to" date', async () => {
    await expect(controller.billingCsv(undefined, 'also-not-a-date', mockRes)).rejects.toThrow(BadRequestException);
  });

  it('rejects a reversed range (from after to)', async () => {
    await expect(controller.billingCsv('2026-06-01', '2026-01-01', mockRes)).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid, non-reversed range', async () => {
    await controller.billingCsv('2026-01-01', '2026-06-01', mockRes);
    expect(mockReports.billingReportCsv).toHaveBeenCalled();
  });

  it('accepts no range at all (both optional)', async () => {
    await controller.billingCsv(undefined, undefined, mockRes);
    expect(mockReports.billingReportCsv).toHaveBeenCalled();
  });
});

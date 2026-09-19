import { ReportsService } from './reports.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('ReportsService (regression: unbounded CSV export)', () => {
  let service: ReportsService;

  const mockPrisma = {
    chargeItem: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.chargeItem.findMany.mockResolvedValue([]);
    mockPrisma.employee.findMany.mockResolvedValue([]);
    service = new ReportsService(mockPrisma as unknown as PrismaService);
  });

  it('caps billingReportCsv at a bounded row count (regression: previously unbounded findMany)', async () => {
    await service.billingReportCsv({});
    expect(mockPrisma.chargeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10_000 }),
    );
  });

  it('caps outstandingReportCsv at a bounded row count', async () => {
    await service.outstandingReportCsv();
    expect(mockPrisma.chargeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10_000 }),
    );
  });

  it('caps patientRegisterCsv at a bounded row count', async () => {
    await service.patientRegisterCsv({});
    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10_000 }),
    );
  });
});

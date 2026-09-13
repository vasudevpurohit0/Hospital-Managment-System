import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('DashboardService (Phase 14 — Admin Dashboard & Analytics)', () => {
  let service: DashboardService;

  const mockPrisma: any = {
    visit: { count: jest.fn().mockResolvedValue(142) },
    admission: {
      count: jest.fn().mockResolvedValue(28),
      groupBy: jest.fn().mockResolvedValue([
        { eligibleCategory: 'A', _count: { _all: 3 } },
        { eligibleCategory: 'C', _count: { _all: 9 } },
      ]),
    },
    bed: { count: jest.fn().mockResolvedValue(50) },
    medicineBatch: { count: jest.fn().mockResolvedValue(4) },
    purchaseRequisition: { count: jest.fn().mockResolvedValue(2) },
    purchaseOrder: { count: jest.fn().mockResolvedValue(3) },
    // As of P7, billing metrics read ChargeItem (the live ledger) rather than
    // the retired BillingTransaction table — see the comment in
    // dashboard.service.ts on why counting the old table would have frozen
    // this section at its pre-P2 values.
    chargeItem: {
      count: jest
        .fn()
        .mockResolvedValueOnce(86) // totalCharges
        .mockResolvedValueOnce(24) // paidCharges
        .mockResolvedValueOnce(65) // permanentChargeCount
        .mockResolvedValueOnce(35), // contractualChargeCount
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(12),
      findMany: jest.fn().mockResolvedValue([
        { id: 'log-1', action: 'DISPENSE', entityType: 'Prescription', entityId: 'rx-1' },
      ]),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getMetrics should return read-only aggregate metrics for all 11 widget areas', async () => {
    const res = await service.getMetrics();
    expect(res.opd).toBeDefined();
    expect(res.ipd).toBeDefined();
    expect(res.inventory).toBeDefined();
    expect(res.procurement).toBeDefined();
    expect(res.billing).toBeDefined();
    expect(res.auditExceptions).toBeDefined();

    expect(res.ipd.totalBeds).toBe(50);
    expect(res.billing.permanentUtilizationPct).toBe(65);
  });
});

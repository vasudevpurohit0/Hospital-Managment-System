import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BenefitOutcome, ChargeStatus } from '@prisma/client';

/**
 * As of P2, this screen reads ChargeItem rather than the retired
 * BillingTransaction table — see the class doc on BillingService for why it
 * stays scoped to pharmacy-origin charges rather than becoming the unified
 * ledger. These tests were rewritten accordingly; the old mocks against
 * `prisma.billingTransaction` no longer describe how this service works.
 */
describe('BillingService (Phase 13 → P2 — pharmacy billing screen)', () => {
  let service: BillingService;

  const mockPrisma: any = {
    chargeItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    brandingConfig: {
      findUnique: jest.fn().mockResolvedValue({ id: 'singleton', hospitalName: 'ESIC Model Hospital & ODC' }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BillingService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAllTransactions scopes to pharmacy-origin charges and returns the legacy-compatible shape', async () => {
    mockPrisma.chargeItem.findMany.mockResolvedValue([
      {
        id: 'charge-01',
        prescriptionItemId: 'rxitem-01',
        benefitOutcome: BenefitOutcome.PAID,
        netAmount: { toString: () => '150' } as any,
        grossAmount: { toString: () => '150' } as any,
        discountAmount: { toString: () => '0' } as any,
        quantity: { toString: () => '1' } as any,
        unitRate: { toString: () => '150' } as any,
        description: 'Paracetamol 500mg',
        categoryName: 'Pharmacy',
        status: ChargeStatus.PENDING,
        createdAt: new Date().toISOString(),
        receipt: null,
        prescriptionItem: { medicineName: 'Paracetamol 500mg' },
      },
    ]);

    const res = await service.findAllTransactions();

    expect(mockPrisma.chargeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { prescriptionItemId: { not: null } } }),
    );
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('charge-01');
    expect(res[0].outcome).toBe(BenefitOutcome.PAID);
    // Superset fields the legacy shape never carried.
    expect(res[0].netAmount).toBe('150');
    expect(res[0].status).toBe(ChargeStatus.PENDING);
  });

  it('getReceipt takes a ChargeItem id (what the frontend has always sent) and renders the print shape', async () => {
    mockPrisma.chargeItem.findUnique.mockResolvedValue({
      id: 'charge-01',
      benefitOutcome: BenefitOutcome.PAID,
      netAmount: { toString: () => '150', valueOf: () => 150 } as any,
      description: 'Paracetamol 500mg',
      status: ChargeStatus.PAID,
      createdAt: new Date().toISOString(),
      prescriptionItem: { dose: '1 tab', frequency: 'TDS', duration: '5 days' },
      visit: {
        employee: {
          employeeId: 'EMP-9001',
          name: 'Rajesh Kumar',
          employmentType: { name: 'Contractual' },
          patientProfile: null,
        },
      },
      receipt: { receiptNumber: 'RCPT/2026/000001' },
    });

    const receipt = await service.getReceipt('charge-01');

    expect(receipt.receiptReference).toBe('RCPT/2026/000001');
    expect(receipt.patientName).toBe('Rajesh Kumar');
    expect(receipt.amountCharged).toBe(150);
    expect(receipt.status).toBe('PAID & ISSUED');
  });

  it('getReceipt throws when the charge does not exist', async () => {
    mockPrisma.chargeItem.findUnique.mockResolvedValue(null);
    await expect(service.getReceipt('missing')).rejects.toThrow('Billing transaction not found');
  });
});

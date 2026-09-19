import { Test, TestingModule } from '@nestjs/testing';
import { PharmacyService } from './pharmacy.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { ProcurementService } from '../procurement/procurement.service';
import { ChargeService } from '../billing/charge.service';
import { ReceiptService } from '../billing/receipt.service';
import { ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { StockStatus, BenefitOutcome } from '@prisma/client';

describe('PharmacyService', () => {
  let service: PharmacyService;

  const mockPrismaService = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    prescription: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    medicineBatch: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    prescriptionItem: {
      update: jest.fn(),
    },
    pharmacyStock: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    stockTransaction: {
      create: jest.fn(),
    },
    billingTransaction: {
      create: jest.fn(),
    },
  };

  const mockBenefitRuleService = {
    evaluate: jest.fn().mockResolvedValue(BenefitOutcome.COVERED),
  };

  const mockProcurementService = {
    checkAndTriggerLowStockRequisition: jest.fn().mockResolvedValue(null),
  };

  const mockChargeService = {
    postPharmacyCharge: jest.fn().mockResolvedValue({ id: 'charge-1', status: 'PENDING' }),
  };

  const mockReceiptService = {
    issue: jest.fn().mockResolvedValue({ id: 'receipt-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PharmacyService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BenefitRuleService, useValue: mockBenefitRuleService },
        { provide: ProcurementService, useValue: mockProcurementService },
        { provide: ChargeService, useValue: mockChargeService },
        { provide: ReceiptService, useValue: mockReceiptService },
      ],
    }).compile();

    service = module.get<PharmacyService>(PharmacyService);
    jest.clearAllMocks();
  });

  it('should return usable medicine batches ordered by FEFO (earliest expiry first) and filter out EXPIRED batches (FR-PHM-07)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      items: [{ id: 'item-1', medicineName: 'Paracetamol' }],
    });

    const earlyBatch = {
      id: 'b-1',
      batchNumber: 'EARLY',
      expiryDate: new Date('2026-10-01'),
      currentStock: 100,
      stockStatus: StockStatus.IN_STOCK,
    };
    const laterBatch = {
      id: 'b-2',
      batchNumber: 'LATER',
      expiryDate: new Date('2027-05-01'),
      currentStock: 200,
      stockStatus: StockStatus.IN_STOCK,
    };

    mockPrismaService.medicineBatch.findMany.mockResolvedValue([earlyBatch, laterBatch]);

    const result = await service.getBatchOptions('rx-1');

    expect(result['item-1']).toBeDefined();
    expect(result['item-1'][0].batchNumber).toBe('EARLY'); // FEFO check
    expect(mockPrismaService.medicineBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stockStatus: {
            notIn: [StockStatus.EXPIRED, StockStatus.QUARANTINED, StockStatus.DISPOSED],
          },
        }),
        orderBy: { expiryDate: 'asc' },
      }),
    );
  });

  it('should reject non-pharmacist user attempting to dispense with ForbiddenException (FR-PHM-08)', async () => {
    await expect(
      service.dispense(
        {
          prescriptionId: 'rx-1',
          items: [{ prescriptionItemId: 'item-1', medicineBatchId: 'b-1', dispenseQuantity: 1 }],
        },
        'user-reception',
        'Reception',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject dispensing from an EXPIRED batch with BadRequestException (FR-PHM-07)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      items: [{ id: 'item-1', medicineName: 'Paracetamol' }],
    });

    mockPrismaService.medicineBatch.findUnique.mockResolvedValue({
      id: 'b-expired',
      batchNumber: 'EXP-99',
      currentStock: 50,
      stockStatus: StockStatus.EXPIRED,
      expiryDate: new Date('2024-01-01'),
    });

    await expect(
      service.dispense(
        {
          prescriptionId: 'rx-1',
          items: [
            { prescriptionItemId: 'item-1', medicineBatchId: 'b-expired', dispenseQuantity: 1 },
          ],
        },
        'user-pharmacist',
        'Pharmacist',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should atomically deduct inventory stock and record append-only StockTransaction', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      items: [{ id: 'item-1', medicineName: 'Paracetamol', dispensedQuantity: 0 }],
      visit: { patientProfile: { employee: { employmentType: { code: 'PERMANENT' } } } },
    });

    mockPrismaService.medicineBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      batchNumber: 'BATCH-100',
      currentStock: 50,
      stockStatus: StockStatus.IN_STOCK,
      expiryDate: new Date('2027-01-01'),
      issuePrice: 10,
    });

    mockPrismaService.prescription.update.mockResolvedValue({
      id: 'rx-1',
      status: 'CLOSED',
    });

    await service.dispense(
      {
        prescriptionId: 'rx-1',
        items: [{ prescriptionItemId: 'item-1', medicineBatchId: 'b-1', dispenseQuantity: 2 }],
      },
      'user-pharmacist',
      'Pharmacist',
    );

    // Atomic conditional decrement (updateMany, not a read-then-write
    // update) -- the exact fix for the confirmed stock-race finding.
    expect(mockPrismaService.medicineBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'b-1', currentStock: { gte: 2 } },
      data: { currentStock: { decrement: 2 } },
    });
    expect(mockPrismaService.medicineBatch.update).not.toHaveBeenCalled();

    expect(mockPrismaService.stockTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'DISPENSE',
        quantity: -2,
        medicineBatchId: 'b-1',
      }),
    });
  });

  it('rejects the dispense with ConflictException if a concurrent request already dropped stock below the requested quantity (regression: previously a plain read-then-write update)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      items: [{ id: 'item-1', medicineName: 'Paracetamol', dispensedQuantity: 0 }],
      visit: { patientProfile: { employee: { employmentType: { code: 'PERMANENT' } } } },
    });
    mockPrismaService.medicineBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      batchNumber: 'BATCH-100',
      currentStock: 50,
      stockStatus: StockStatus.IN_STOCK,
      expiryDate: new Date('2027-01-01'),
      issuePrice: 10,
    });
    mockPrismaService.medicineBatch.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.dispense(
        {
          prescriptionId: 'rx-1',
          items: [{ prescriptionItemId: 'item-1', medicineBatchId: 'b-1', dispenseQuantity: 2 }],
        },
        'user-pharmacist',
        'Pharmacist',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('reconciles the PHARMACY-location PharmacyStock row when dispensing (regression: previously never touched, only MedicineBatch.currentStock was decremented)', async () => {
    mockPrismaService.prescription.findUnique.mockResolvedValue({
      id: 'rx-1',
      items: [{ id: 'item-1', medicineName: 'Paracetamol', dispensedQuantity: 0 }],
      visit: { patientProfile: { employee: { employmentType: { code: 'PERMANENT' } } } },
    });
    mockPrismaService.medicineBatch.findUnique.mockResolvedValue({
      id: 'b-1',
      batchNumber: 'BATCH-100',
      currentStock: 50,
      stockStatus: StockStatus.IN_STOCK,
      expiryDate: new Date('2027-01-01'),
      issuePrice: 10,
    });
    mockPrismaService.pharmacyStock.findFirst.mockResolvedValueOnce({
      id: 'pharm-stock-1',
      quantity: 10,
    });
    mockPrismaService.prescription.update.mockResolvedValue({ id: 'rx-1', status: 'CLOSED' });

    await service.dispense(
      {
        prescriptionId: 'rx-1',
        items: [{ prescriptionItemId: 'item-1', medicineBatchId: 'b-1', dispenseQuantity: 2 }],
      },
      'user-pharmacist',
      'Pharmacist',
    );

    expect(mockPrismaService.pharmacyStock.update).toHaveBeenCalledWith({
      where: { id: 'pharm-stock-1' },
      data: { quantity: { decrement: 2 } },
    });
  });
});

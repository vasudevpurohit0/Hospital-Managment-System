import { Test, TestingModule } from '@nestjs/testing';
import { ProcurementService } from './procurement.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { BadRequestException } from '@nestjs/common';
import { ApprovalDecision, RequisitionStatus, POStatus, PharmacyLocation } from '@prisma/client';

describe('ProcurementService (Phase 12 — Supply Chain & Procurement)', () => {
  let service: ProcurementService;

  const mockPrisma: any = {
    purchaseRequisition: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    approval: {
      create: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    goodsReceiptNote: {
      create: jest.fn(),
    },
    medicineBatch: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    pharmacyStock: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    storeTransfer: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: any) => any) => cb(mockPrisma)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcurementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PlatformPrismaService, useValue: { hospital: { findMany: jest.fn().mockResolvedValue([]) } } },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProcurementService>(ProcurementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRequisition & approveRequisition', () => {
    it('should create a pending purchase requisition', async () => {
      mockPrisma.purchaseRequisition.create.mockResolvedValue({
        id: 'req-01',
        raisedBy: 'user-01',
        status: RequisitionStatus.PENDING,
        items: [{ medicineId: 'med-01', quantity: 100 }],
        approvals: [],
      });

      const res = await service.createRequisition(
        { items: [{ medicineId: 'med-01', quantity: 100 }] },
        'user-01',
      );

      expect(res.id).toBe('req-01');
      expect(res.status).toBe(RequisitionStatus.PENDING);
    });

    it('should record approval decision and update requisition status to APPROVED', async () => {
      mockPrisma.purchaseRequisition.findUnique.mockResolvedValue({
        id: 'req-01',
        status: RequisitionStatus.PENDING,
      });

      mockPrisma.approval.create.mockResolvedValue({
        id: 'appr-01',
        requisitionId: 'req-01',
        approvedBy: 'user-manager',
        decision: ApprovalDecision.APPROVED,
      });

      const res = await service.approveRequisition(
        'req-01',
        { decision: ApprovalDecision.APPROVED, notes: 'Looks good' },
        'user-manager',
      );

      expect(res.decision).toBe(ApprovalDecision.APPROVED);
      expect(mockPrisma.purchaseRequisition.update).toHaveBeenCalledWith({
        where: { id: 'req-01' },
        data: { status: RequisitionStatus.APPROVED },
      });
    });

    it('rejects self-approval: the user who raised a requisition cannot approve/reject it (regression: StoreManager holds both permissions)', async () => {
      mockPrisma.purchaseRequisition.findUnique.mockResolvedValue({
        id: 'req-01',
        raisedBy: 'user-storemanager',
        status: RequisitionStatus.PENDING,
      });

      await expect(
        service.approveRequisition(
          'req-01',
          { decision: ApprovalDecision.APPROVED },
          'user-storemanager',
        ),
      ).rejects.toThrow();
      expect(mockPrisma.approval.create).not.toHaveBeenCalled();
    });

    it('rejects deciding a requisition a second time (regression: previously could flip status back and forth indefinitely)', async () => {
      mockPrisma.purchaseRequisition.findUnique.mockResolvedValue({
        id: 'req-01',
        raisedBy: 'user-01',
        status: RequisitionStatus.APPROVED,
      });

      await expect(
        service.approveRequisition(
          'req-01',
          { decision: ApprovalDecision.REJECTED },
          'user-manager',
        ),
      ).rejects.toThrow();
      expect(mockPrisma.approval.create).not.toHaveBeenCalled();
    });
  });

  describe('createPurchaseOrder (Strict FR-SCM-03 Approval Check)', () => {
    it('should THROW BadRequestException if requisition is NOT approved (FR-SCM-03)', async () => {
      mockPrisma.purchaseRequisition.findUnique.mockResolvedValue({
        id: 'req-unapproved',
        status: RequisitionStatus.PENDING,
        approvals: [],
      });

      await expect(
        service.createPurchaseOrder(
          {
            requisitionId: 'req-unapproved',
            supplierId: 'sup-01',
            items: [{ medicineId: 'med-01', quantity: 100, unitPrice: 10 }],
          },
          'user-procurement',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should SUCCEED in issuing Purchase Order when requisition is APPROVED', async () => {
      mockPrisma.purchaseRequisition.findUnique.mockResolvedValue({
        id: 'req-approved',
        status: RequisitionStatus.APPROVED,
        approvals: [{ decision: ApprovalDecision.APPROVED }],
      });

      mockPrisma.purchaseOrder.create.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-approved',
        supplierId: 'sup-01',
        status: POStatus.ISSUED,
        items: [{ medicineId: 'med-01', quantity: 100, unitPrice: 10 }],
      });

      const res = await service.createPurchaseOrder(
        {
          requisitionId: 'req-approved',
          supplierId: 'sup-01',
          items: [{ medicineId: 'med-01', quantity: 100, unitPrice: 10 }],
        },
        'user-procurement',
      );

      expect(res.id).toBe('po-01');
      expect(res.status).toBe(POStatus.ISSUED);
    });
  });

  describe('createGRN', () => {
    it('should create Goods Receipt Note, create new MedicineBatch rows, and add stock to CentralStore', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-01',
        supplierId: 'sup-01',
        status: POStatus.ISSUED,
        items: [{ medicineId: 'med-01', quantity: 500 }],
        goodsReceiptNotes: [],
      });

      mockPrisma.goodsReceiptNote.create.mockResolvedValue({
        id: 'grn-01',
        purchaseOrderId: 'po-01',
        verifiedBy: 'user-storemanager',
        items: [],
      });

      mockPrisma.medicineBatch.create.mockResolvedValue({
        id: 'batch-grn-01',
        batchNumber: 'GRN-B1',
      });

      mockPrisma.pharmacyStock.create.mockResolvedValue({
        id: 'stock-central-01',
        location: PharmacyLocation.CENTRAL_STORE,
        quantity: 500,
      });

      const res = await service.createGRN(
        {
          purchaseOrderId: 'po-01',
          items: [
            {
              medicineId: 'med-01',
              batchNumber: 'GRN-B1',
              manufacturer: 'Sun Pharma',
              quantity: 500,
              manufacturingDate: '2026-01-01',
              expiryDate: '2028-01-01',
              purchasePrice: 10,
              issuePrice: 15,
              qualityCheckPass: true,
            },
          ],
        },
        'user-storemanager',
      );

      expect(res.id).toBe('grn-01');
      expect(mockPrisma.medicineBatch.create).toHaveBeenCalled();
      expect(mockPrisma.pharmacyStock.create).toHaveBeenCalledWith({
        data: {
          medicineBatchId: 'batch-grn-01',
          location: PharmacyLocation.CENTRAL_STORE,
          quantity: 500,
        },
      });
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-01' },
        data: { status: POStatus.RECEIVED },
      });
    });

    it('rejects a GRN item for a medicine not on the Purchase Order (regression: previously no cross-check existed at all)', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-01',
        supplierId: 'sup-01',
        status: POStatus.ISSUED,
        items: [{ medicineId: 'med-01', quantity: 500 }],
        goodsReceiptNotes: [],
      });

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-01',
            items: [
              {
                medicineId: 'med-NOT-ORDERED',
                batchNumber: 'GRN-B1',
                manufacturer: 'Sun Pharma',
                quantity: 10,
                manufacturingDate: '2026-01-01',
                expiryDate: '2028-01-01',
                purchasePrice: 10,
                issuePrice: 15,
              },
            ],
          },
          'user-storemanager',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.medicineBatch.create).not.toHaveBeenCalled();
    });

    it('rejects receiving more than was ordered (regression: previously unbounded)', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-01',
        supplierId: 'sup-01',
        status: POStatus.ISSUED,
        items: [{ medicineId: 'med-01', quantity: 500 }],
        goodsReceiptNotes: [],
      });

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-01',
            items: [
              {
                medicineId: 'med-01',
                batchNumber: 'GRN-B1',
                manufacturer: 'Sun Pharma',
                quantity: 600, // exceeds the 500 ordered
                manufacturingDate: '2026-01-01',
                expiryDate: '2028-01-01',
                purchasePrice: 10,
                issuePrice: 15,
              },
            ],
          },
          'user-storemanager',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a GRN against a Purchase Order that has already been fully received (regression: previously accepted repeatedly)', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-01',
        supplierId: 'sup-01',
        status: POStatus.RECEIVED,
        items: [{ medicineId: 'med-01', quantity: 500 }],
        goodsReceiptNotes: [{ items: [{ medicineId: 'med-01', quantity: 500 }] }],
      });

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-01',
            items: [
              {
                medicineId: 'med-01',
                batchNumber: 'GRN-B2',
                manufacturer: 'Sun Pharma',
                quantity: 50,
                manufacturingDate: '2026-01-01',
                expiryDate: '2028-01-01',
                purchasePrice: 10,
                issuePrice: 15,
              },
            ],
          },
          'user-storemanager',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves the PO as ISSUED (not RECEIVED) and the requisition un-fulfilled after only a partial receipt', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-01',
        requisitionId: 'req-01',
        supplierId: 'sup-01',
        status: POStatus.ISSUED,
        items: [{ medicineId: 'med-01', quantity: 500 }],
        goodsReceiptNotes: [],
      });
      mockPrisma.goodsReceiptNote.create.mockResolvedValue({ id: 'grn-partial', items: [] });
      mockPrisma.medicineBatch.create.mockResolvedValue({ id: 'batch-partial' });

      await service.createGRN(
        {
          purchaseOrderId: 'po-01',
          items: [
            {
              medicineId: 'med-01',
              batchNumber: 'GRN-B1',
              manufacturer: 'Sun Pharma',
              quantity: 200, // only part of the 500 ordered
              manufacturingDate: '2026-01-01',
              expiryDate: '2028-01-01',
              purchasePrice: 10,
              issuePrice: 15,
            },
          ],
        },
        'user-storemanager',
      );

      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
      expect(mockPrisma.purchaseRequisition.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: RequisitionStatus.FULFILLED } }),
      );
    });
  });

  describe('createStoreTransfer', () => {
    it('should atomically decrease Central Store stock and increase Pharmacy stock', async () => {
      mockPrisma.medicineBatch.findUnique.mockResolvedValue({ id: 'batch-01' });

      mockPrisma.pharmacyStock.findFirst
        .mockResolvedValueOnce({
          id: 'stock-central',
          location: PharmacyLocation.CENTRAL_STORE,
          quantity: 500,
        })
        .mockResolvedValueOnce({
          id: 'stock-pharmacy',
          location: PharmacyLocation.PHARMACY,
          quantity: 100,
        });

      mockPrisma.storeTransfer.create.mockResolvedValue({
        id: 'transfer-01',
        medicineBatchId: 'batch-01',
        quantity: 200,
      });

      const res = await service.createStoreTransfer(
        {
          medicineBatchId: 'batch-01',
          fromLocation: PharmacyLocation.CENTRAL_STORE,
          toLocation: PharmacyLocation.PHARMACY,
          quantity: 200,
        },
        'user-storemanager',
      );

      expect(res.id).toBe('transfer-01');
      expect(mockPrisma.pharmacyStock.updateMany).toHaveBeenCalledWith({
        where: { id: 'stock-central', quantity: { gte: 200 } },
        data: { quantity: { decrement: 200 } },
      });
      expect(mockPrisma.pharmacyStock.update).toHaveBeenCalledWith({
        where: { id: 'stock-pharmacy' },
        data: { quantity: { increment: 200 } },
      });
    });

    it('should THROW BadRequestException if Central Store has insufficient stock (regression: now enforced by the atomic conditional update, not just an upfront read)', async () => {
      mockPrisma.medicineBatch.findUnique.mockResolvedValue({ id: 'batch-01' });

      mockPrisma.pharmacyStock.findFirst.mockResolvedValueOnce({
        id: 'stock-central',
        location: PharmacyLocation.CENTRAL_STORE,
        quantity: 50,
      });
      mockPrisma.pharmacyStock.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.createStoreTransfer(
          {
            medicineBatchId: 'batch-01',
            fromLocation: PharmacyLocation.CENTRAL_STORE,
            toLocation: PharmacyLocation.PHARMACY,
            quantity: 200,
          },
          'user-storemanager',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

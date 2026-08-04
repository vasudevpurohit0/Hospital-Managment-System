import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { ApproveRequisitionDto } from './dto/approve-requisition.dto';
import { CreatePODto } from './dto/create-po.dto';
import { CreateGRNDto } from './dto/create-grn.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import {
  RequisitionStatus,
  ApprovalDecision,
  POStatus,
  PharmacyLocation,
  StockStatus,
} from '@prisma/client';

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(private prisma: PrismaService) {}

  // 1. Create Purchase Requisition
  async createRequisition(dto: CreateRequisitionDto, userId: string) {
    return this.prisma.purchaseRequisition.create({
      data: {
        raisedBy: userId,
        triggeredByAlert: dto.triggeredByAlert ?? false,
        status: RequisitionStatus.PENDING,
        items: {
          create: dto.items.map((i) => ({
            medicineId: i.medicineId,
            quantity: i.quantity,
          })),
        },
      },
      include: { items: { include: { medicine: true } }, approvals: true },
    });
  }

  // 2. Find All Requisitions
  async findAllRequisitions() {
    return this.prisma.purchaseRequisition.findMany({
      include: {
        items: { include: { medicine: true } },
        approvals: { include: { approver: true } },
        purchaseOrders: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 3. Approve or Reject Requisition
  async approveRequisition(requisitionId: string, dto: ApproveRequisitionDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.purchaseRequisition.findUnique({ where: { id: requisitionId } });
      if (!req) throw new NotFoundException(`Requisition not found: ${requisitionId}`);

      const approval = await tx.approval.create({
        data: {
          requisitionId,
          approvedBy: userId,
          decision: dto.decision,
          notes: dto.notes || null,
        },
      });

      const newStatus =
        dto.decision === ApprovalDecision.APPROVED
          ? RequisitionStatus.APPROVED
          : RequisitionStatus.REJECTED;

      await tx.purchaseRequisition.update({
        where: { id: requisitionId },
        data: { status: newStatus },
      });

      return approval;
    });
  }

  // 4. Create Purchase Order (Strict Service-Layer Approval Check FR-SCM-03)
  async createPurchaseOrder(dto: CreatePODto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.purchaseRequisition.findUnique({
        where: { id: dto.requisitionId },
        include: { approvals: true },
      });

      if (!req) throw new NotFoundException(`Requisition not found: ${dto.requisitionId}`);

      // Strict FR-SCM-03 Enforcement: Requisition MUST be approved
      const isApproved =
        req.status === RequisitionStatus.APPROVED ||
        req.approvals.some((a) => a.decision === ApprovalDecision.APPROVED);

      if (!isApproved) {
        throw new BadRequestException(
          `Cannot create Purchase Order: Requisition ${dto.requisitionId} is not approved (FR-SCM-03).`,
        );
      }

      return tx.purchaseOrder.create({
        data: {
          requisitionId: dto.requisitionId,
          supplierId: dto.supplierId,
          issuedBy: userId,
          status: POStatus.ISSUED,
          items: {
            create: dto.items.map((i) => ({
              medicineId: i.medicineId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: { items: { include: { medicine: true } }, supplier: true },
      });
    });
  }

  // 5. Find All Purchase Orders
  async findAllPurchaseOrders() {
    return this.prisma.purchaseOrder.findMany({
      include: {
        items: { include: { medicine: true } },
        supplier: true,
        goodsReceiptNotes: true,
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  // 6. Record Goods Receipt Note (GRN) -> Creates new MedicineBatch rows & CentralStore stock
  async createGRN(dto: CreateGRNDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId } });
      if (!po) throw new NotFoundException(`Purchase Order not found: ${dto.purchaseOrderId}`);

      const grn = await tx.goodsReceiptNote.create({
        data: {
          purchaseOrderId: dto.purchaseOrderId,
          verifiedBy: userId,
          items: {
            create: dto.items.map((i) => ({
              medicineId: i.medicineId,
              batchNumber: i.batchNumber,
              manufacturer: i.manufacturer,
              quantity: i.quantity,
              manufacturingDate: new Date(i.manufacturingDate),
              expiryDate: new Date(i.expiryDate),
              purchasePrice: i.purchasePrice,
              issuePrice: i.issuePrice,
              qualityCheckPass: i.qualityCheckPass ?? true,
            })),
          },
        },
        include: { items: true },
      });

      // For each passed item, create new MedicineBatch & add Central Store stock
      for (const item of dto.items) {
        if (item.qualityCheckPass === false) continue;

        const batch = await tx.medicineBatch.create({
          data: {
            medicineId: item.medicineId,
            batchNumber: item.batchNumber,
            manufacturer: item.manufacturer,
            supplierId: po.supplierId,
            manufacturingDate: new Date(item.manufacturingDate),
            expiryDate: new Date(item.expiryDate),
            purchasePrice: item.purchasePrice,
            issuePrice: item.issuePrice,
            currentStock: item.quantity,
            minimumStockLevel: 50,
            reorderLevel: 100,
            stockStatus: StockStatus.IN_STOCK,
          },
        });

        // Add Central Store stock
        await tx.pharmacyStock.create({
          data: {
            medicineBatchId: batch.id,
            location: PharmacyLocation.CENTRAL_STORE,
            quantity: item.quantity,
          },
        });
      }

      // Update PO status to RECEIVED
      await tx.purchaseOrder.update({
        where: { id: dto.purchaseOrderId },
        data: { status: POStatus.RECEIVED },
      });

      return grn;
    });
  }

  // 7. Store Transfer (Atomic Central Store -> Pharmacy)
  async createStoreTransfer(dto: CreateTransferDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.medicineBatch.findUnique({ where: { id: dto.medicineBatchId } });
      if (!batch) throw new NotFoundException(`Batch not found: ${dto.medicineBatchId}`);

      const centralStock = await tx.pharmacyStock.findFirst({
        where: { medicineBatchId: dto.medicineBatchId, location: dto.fromLocation },
      });

      if (!centralStock || centralStock.quantity < dto.quantity) {
        throw new BadRequestException(
          `Insufficient stock at ${dto.fromLocation}: available ${centralStock?.quantity || 0}, requested ${dto.quantity}`,
        );
      }

      // 1. Decrease CentralStore stock
      await tx.pharmacyStock.update({
        where: { id: centralStock.id },
        data: { quantity: { decrement: dto.quantity } },
      });

      // 2. Increase Pharmacy stock
      const pharmStock = await tx.pharmacyStock.findFirst({
        where: { medicineBatchId: dto.medicineBatchId, location: dto.toLocation },
      });

      if (pharmStock) {
        await tx.pharmacyStock.update({
          where: { id: pharmStock.id },
          data: { quantity: { increment: dto.quantity } },
        });
      } else {
        await tx.pharmacyStock.create({
          data: {
            medicineBatchId: dto.medicineBatchId,
            location: dto.toLocation,
            quantity: dto.quantity,
          },
        });
      }

      // 3. Record StoreTransfer entry
      return tx.storeTransfer.create({
        data: {
          medicineBatchId: dto.medicineBatchId,
          fromLocation: dto.fromLocation,
          toLocation: dto.toLocation,
          quantity: dto.quantity,
          transferredBy: userId,
        },
      });
    });
  }
}

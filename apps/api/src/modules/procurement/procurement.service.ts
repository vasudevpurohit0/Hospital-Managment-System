import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { runWithTenant } from '../../common/tenant/tenant-context';

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private prisma: PrismaService,
    private platformPrisma: PlatformPrismaService,
    private tenantClients: TenantClientFactory,
  ) {}

  /**
   * Periodic scan to detect and resolve requisitions for existing low-stock
   * items. Used to run once at app-process boot against "the" database;
   * converted to a recurring per-tenant job (like IpdFinanceService's nightly
   * bed-day job) since there is no single database to scan at boot anymore,
   * and a hospital onboarded after the process started would otherwise never
   * get this scan at all.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async runLowStockScanAllHospitals(): Promise<void> {
    const hospitals = await this.platformPrisma.hospital.findMany({ where: { status: 'ACTIVE' } });
    for (const hospital of hospitals) {
      try {
        const client = await this.tenantClients.getClient(hospital.schemaName);
        await runWithTenant(
          { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
          () => this.scanLowStock(),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Low-stock scan failed for hospital "${hospital.slug}": ${message}`);
      }
    }
  }

  private async scanLowStock() {
    this.logger.log('🔍 Running low-stock inventory scan...');
    // Prisma's fluent `where` can't compare `currentStock` to
    // `minimumStockLevel` (a field-to-field comparison), so this used to
    // fetch every non-disposed batch's full row into Node and filter
    // in-process. A raw query does the comparison at the database and only
    // ever returns the ids that actually need a requisition.
    const lowStockBatches = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM medicine_batches
      WHERE stock_status != ${StockStatus.DISPOSED}::"StockStatus"
        AND current_stock < minimum_stock_level
    `;

    let triggeredCount = 0;
    for (const batch of lowStockBatches) {
      await this.prisma.$transaction(async (tx) => {
        await this.checkAndTriggerLowStockRequisition(batch.id, tx);
      });
      triggeredCount++;
    }

    if (triggeredCount > 0) {
      this.logger.log(`🔔 Automatically generated requisitions for ${triggeredCount} low-stock batches.`);
    } else {
      this.logger.log('✅ All inventory levels are healthy or already requested.');
    }
  }

  // 1. Create Purchase Requisition
  async createRequisition(dto: CreateRequisitionDto, userId: string) {
    return this.prisma.purchaseRequisition.create({
      data: {
        raisedBy: userId,
        triggeredByAlert: dto.triggeredByAlert ?? false,
        triggerReason: dto.triggerReason || null,
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

      // Segregation of duties: whoever raised a requisition cannot also be
      // the one who approves/rejects it, even if their role holds both
      // permissions (e.g. StoreManager holds both PurchaseRequisition:create
      // and Approval:approve).
      if (req.raisedBy === userId) {
        throw new ForbiddenException(
          'You cannot approve or reject a requisition you raised yourself.',
        );
      }

      // A requisition can only be decided once -- without this, repeated
      // calls create multiple Approval rows and can flip status back and
      // forth between APPROVED/REJECTED indefinitely.
      if (req.status !== RequisitionStatus.PENDING) {
        throw new ConflictException(
          `Requisition ${requisitionId} has already been ${req.status.toLowerCase()} and cannot be decided again.`,
        );
      }

      // Update item quantities if requested by the Procurement Officer
      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          await tx.requisitionItem.update({
            where: { id: item.itemId },
            data: { quantity: item.quantity },
          });
        }
      }

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

  // 4.5. Find All Suppliers
  async findAllSuppliers() {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
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
      const po = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: { items: true, goodsReceiptNotes: { include: { items: true } } },
      });
      if (!po) throw new NotFoundException(`Purchase Order not found: ${dto.purchaseOrderId}`);

      if (po.status === POStatus.RECEIVED || po.status === POStatus.CLOSED) {
        throw new BadRequestException(
          `Purchase Order ${dto.purchaseOrderId} has already been fully received and cannot accept another goods receipt.`,
        );
      }

      // Cross-validate this GRN against what was actually ordered: every
      // received medicine must be a line item on the PO, and cumulative
      // received quantity (across this GRN and every prior one against the
      // same PO) can never exceed what was ordered for it.
      const orderedByMedicine = new Map<string, number>();
      for (const item of po.items) {
        orderedByMedicine.set(item.medicineId, (orderedByMedicine.get(item.medicineId) ?? 0) + item.quantity);
      }
      const receivedByMedicine = new Map<string, number>();
      for (const priorGrn of po.goodsReceiptNotes) {
        for (const item of priorGrn.items) {
          receivedByMedicine.set(
            item.medicineId,
            (receivedByMedicine.get(item.medicineId) ?? 0) + item.quantity,
          );
        }
      }
      for (const item of dto.items) {
        const ordered = orderedByMedicine.get(item.medicineId);
        if (ordered === undefined) {
          throw new BadRequestException(
            `Medicine ${item.medicineId} is not part of Purchase Order ${dto.purchaseOrderId} and cannot be received against it.`,
          );
        }
        const alreadyReceived = receivedByMedicine.get(item.medicineId) ?? 0;
        if (alreadyReceived + item.quantity > ordered) {
          throw new BadRequestException(
            `Cannot receive ${item.quantity} of medicine ${item.medicineId}: only ${ordered - alreadyReceived} remaining against Purchase Order ${dto.purchaseOrderId} (ordered ${ordered}, already received ${alreadyReceived}).`,
          );
        }
        receivedByMedicine.set(item.medicineId, alreadyReceived + item.quantity);
      }

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
            maximumStockLevel: 500,
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

      // Only flip the PO (and its requisition) to fully-received once every
      // ordered line item has actually been received in full -- previously
      // this ran unconditionally on ANY GRN, marking a requisition FULFILLED
      // even after a partial or short receipt.
      const fullyReceived = [...orderedByMedicine.entries()].every(
        ([medicineId, ordered]) => (receivedByMedicine.get(medicineId) ?? 0) >= ordered,
      );

      if (fullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: dto.purchaseOrderId },
          data: { status: POStatus.RECEIVED },
        });

        if (po.requisitionId) {
          await tx.purchaseRequisition.update({
            where: { id: po.requisitionId },
            data: { status: RequisitionStatus.FULFILLED },
          });
        }
      }

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

      if (!centralStock) {
        throw new BadRequestException(`No stock recorded at ${dto.fromLocation} for this batch.`);
      }

      // 1. Decrease CentralStore stock -- a conditional `updateMany` guarded
      // by the current quantity, not a plain read-then-`update`, so two
      // concurrent transfers draining the same source row can't both pass
      // the check and jointly overdraw it (the same race class as pharmacy
      // dispense elsewhere in this codebase).
      const decremented = await tx.pharmacyStock.updateMany({
        where: { id: centralStock.id, quantity: { gte: dto.quantity } },
        data: { quantity: { decrement: dto.quantity } },
      });
      if (decremented.count === 0) {
        throw new BadRequestException(
          `Insufficient stock at ${dto.fromLocation}: requested ${dto.quantity} exceeds what is currently available.`,
        );
      }

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

  /**
   * Automatically check batch stock and trigger a low-stock requisition if needed.
   * Enforces duplicate protection and calculates reorder quantity.
   */
  async checkAndTriggerLowStockRequisition(batchId: string, tx: any, userId?: string) {
    // 1. Fetch the batch with its medicine details
    const batch = await tx.medicineBatch.findUnique({
      where: { id: batchId },
      include: { medicine: true },
    });
    if (!batch) return;

    // 2. Check if currentStock is below minimumStockLevel
    if (batch.currentStock >= batch.minimumStockLevel) {
      return;
    }

    // 3. Check for any active requisition for this medicine to prevent duplicates
    // Active means status is PENDING or APPROVED (with PO not RECEIVED and not CLOSED)
    const activeRequisitions = await tx.purchaseRequisition.findMany({
      where: {
        items: {
          some: {
            medicineId: batch.medicineId,
          },
        },
        OR: [
          { status: RequisitionStatus.PENDING },
          {
            status: RequisitionStatus.APPROVED,
            OR: [
              {
                purchaseOrders: {
                  none: {},
                },
              },
              {
                purchaseOrders: {
                  some: {
                    status: {
                      in: [POStatus.ISSUED, POStatus.DISPATCHED],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    if (activeRequisitions.length > 0) {
      // Requisition already in progress, bypass duplicate generation
      return;
    }

    // 4. Calculate suggested quantity: Maximum Stock Level - Current Stock
    const maxStock = batch.maximumStockLevel ?? 500;
    const suggestedQuantity = Math.max(0, maxStock - batch.currentStock);

    if (suggestedQuantity <= 0) return;

    // 5. Use the user ID of the pharmacist/system. If not provided, find a system/receptionist or fallback to seed user.
    let raisedBy = userId;
    if (!raisedBy) {
      const defaultUser = await tx.user.findFirst({
        where: { role: { name: 'Administrator' } },
      });
      raisedBy = defaultUser?.id ?? '35b02c7d-cb73-405f-a239-e987c468d093'; // Admin/seed fallback
    }

    // 6. Create the PurchaseRequisition
    const requisition = await tx.purchaseRequisition.create({
      data: {
        raisedBy,
        triggeredByAlert: true,
        triggerReason: 'Automatic Low Stock Detection',
        status: RequisitionStatus.PENDING,
        items: {
          create: [{
            medicineId: batch.medicineId,
            quantity: suggestedQuantity,
          }],
        },
      },
      include: {
        items: { include: { medicine: true } },
      },
    });

    // 7. Write an Audit Log entry for the action
    await tx.auditLog.create({
      data: {
        actorUserId: raisedBy,
        actorRole: 'System',
        action: 'AUTOMATIC_LOW_STOCK_DETECTION',
        entityType: 'PurchaseRequisition',
        entityId: requisition.id,
        afterSnapshot: {
          medicineName: batch.medicine.genericName,
          currentStock: batch.currentStock,
          minimumStock: batch.minimumStockLevel,
          suggestedQuantity,
          reason: 'Automatic Low Stock Detection',
        },
      },
    });

    this.logger.log(
      `🔔 Generated Automatic Low Stock Requisition for ${batch.medicine.genericName}. Stock: ${batch.currentStock}/${batch.minimumStockLevel}. Suggested: ${suggestedQuantity}`,
    );
  }
}

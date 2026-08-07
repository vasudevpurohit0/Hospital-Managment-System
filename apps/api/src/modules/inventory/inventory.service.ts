import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { StockStatus, PharmacyLocation, RequisitionStatus, POStatus } from '@prisma/client';
import { ProcurementService } from '../procurement/procurement.service';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private prisma: PrismaService,
    private procurementService: ProcurementService,
  ) {}

  /**
   * Fetch all medicines with active stock batches from PostgreSQL DB
   */
  async findAllMedicines() {
    const medicines = await this.prisma.medicine.findMany({
      include: {
        batches: {
          include: { supplier: true },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { genericName: 'asc' },
    });

    const activeRequisitions = await this.prisma.purchaseRequisition.findMany({
      where: {
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
      include: {
        items: true,
      },
    });

    const activeMedIds = new Set<string>();
    for (const req of activeRequisitions) {
      for (const item of req.items) {
        activeMedIds.add(item.medicineId);
      }
    }

    return medicines.map((med) => ({
      ...med,
      hasActiveRequisition: activeMedIds.has(med.id),
      batches: med.batches.map((batch) => ({
        ...batch,
        hasActiveRequisition: activeMedIds.has(med.id),
      })),
    }));
  }

  /**
   * Create new Medicine Master record in PostgreSQL DB
   */
  async createMedicine(dto: CreateMedicineDto) {
    return this.prisma.medicine.create({
      data: {
        genericName: dto.genericName,
        brandName: dto.brandName || null,
        category: dto.category,
        strength: dto.strength,
        dosageForm: dto.dosageForm,
      },
    });
  }

  /**
   * Create new stock batch in PostgreSQL DB
   */
  async createBatch(dto: CreateBatchDto) {
    const med = await this.prisma.medicine.findUnique({
      where: { id: dto.medicineId },
    });
    if (!med) throw new NotFoundException(`Medicine not found for ID: ${dto.medicineId}`);

    const batch = await this.prisma.medicineBatch.create({
      data: {
        medicineId: dto.medicineId,
        batchNumber: dto.batchNumber,
        manufacturer: dto.manufacturer,
        supplierId: dto.supplierId || null,
        manufacturingDate: new Date(dto.manufacturingDate),
        expiryDate: new Date(dto.expiryDate),
        purchasePrice: dto.purchasePrice,
        issuePrice: dto.issuePrice,
        currentStock: dto.currentStock,
        minimumStockLevel: dto.minimumStockLevel ?? 50,
        reorderLevel: dto.reorderLevel ?? 100,
        maximumStockLevel: dto.maximumStockLevel ?? 500,
        storageLocation: dto.storageLocation || null,
        stockStatus:
          dto.currentStock <= (dto.minimumStockLevel ?? 50)
            ? StockStatus.CRITICAL_ALERT
            : dto.currentStock <= (dto.reorderLevel ?? 100)
              ? StockStatus.EARLY_WARNING
              : StockStatus.IN_STOCK,
      },
    });

    // Create PharmacyStock entry
    await this.prisma.pharmacyStock.create({
      data: {
        medicineBatchId: batch.id,
        location: PharmacyLocation.PHARMACY,
        quantity: dto.currentStock,
      },
    });

    // Trigger low stock check
    await this.procurementService.checkAndTriggerLowStockRequisition(batch.id, this.prisma);

    return batch;
  }

  /**
   * Fetch batches below reorder level from PostgreSQL DB
   */
  async getLowStockAlerts() {
    const allBatches = await this.prisma.medicineBatch.findMany({
      include: { medicine: true },
      orderBy: { currentStock: 'asc' },
    });

    return allBatches.filter((b) => b.currentStock <= b.reorderLevel);
  }

  /**
   * Fetch Pharmacy stock from PostgreSQL DB
   */
  async getPharmacyStock() {
    return this.prisma.pharmacyStock.findMany({
      include: {
        batch: {
          include: { medicine: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Fetch expiring batches from PostgreSQL DB
   */
  async getExpiringBatches(withinDays = 90) {
    const thresholdDate = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    return this.prisma.medicineBatch.findMany({
      where: {
        expiryDate: { lte: thresholdDate },
        stockStatus: { notIn: [StockStatus.DISPOSED] },
      },
      include: { medicine: true, supplier: true },
      orderBy: { expiryDate: 'asc' },
    });
  }

  /**
   * Quarantine batch in PostgreSQL DB
   */
  async quarantineBatch(batchId: string, _reason?: string) {
    return this.prisma.medicineBatch.update({
      where: { id: batchId },
      data: { stockStatus: StockStatus.QUARANTINED },
    });
  }

  /**
   * Dispose batch in PostgreSQL DB
   */
  async disposeBatch(
    batchId: string,
    dto: { disposalReason: string; notes?: string },
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.medicineBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException(`Batch not found: ${batchId}`);

      const stockToDispose = batch.currentStock;

      const updatedBatch = await tx.medicineBatch.update({
        where: { id: batchId },
        data: {
          currentStock: 0,
          stockStatus: StockStatus.DISPOSED,
        },
      });

      await tx.stockTransaction.create({
        data: {
          type: 'DISPOSAL',
          medicineBatchId: batchId,
          quantity: -stockToDispose,
          performedBy: userId,
        },
      });

      // Trigger low stock check since stock becomes 0
      await this.procurementService.checkAndTriggerLowStockRequisition(batchId, tx, userId);

      return updatedBatch;
    });
  }
}

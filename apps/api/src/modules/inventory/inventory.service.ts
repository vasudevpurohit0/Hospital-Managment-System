import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { StockStatus, PharmacyLocation, RequisitionStatus, POStatus } from '@prisma/client';
import { ProcurementService } from '../procurement/procurement.service';
import {
  parseMedicineSpreadsheet,
  generateMedicineErrorReportXlsx,
  generateMedicineTemplateXlsx,
  RejectedImportRow,
} from './excel/medicine-excel.util';
import { EARLY_WARNING_WINDOW_DAYS, daysFromNow } from '../../common/inventory/expiry-window.const';

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
    // Prisma's fluent `where` can't compare `currentStock` to `reorderLevel`
    // (a field-to-field comparison), so this used to fetch every batch in
    // the table into Node and filter in-process. The raw query below does
    // the comparison at the database, so only the ids that actually qualify
    // ever leave Postgres; the real (fully-`include`d) rows for just those
    // ids are then fetched the normal way.
    const lowStockIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM medicine_batches WHERE current_stock <= reorder_level
    `;
    if (lowStockIds.length === 0) return [];

    return this.prisma.medicineBatch.findMany({
      where: { id: { in: lowStockIds.map((b) => b.id) } },
      include: { medicine: true },
      orderBy: { currentStock: 'asc' },
    });
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
  async getExpiringBatches(withinDays = EARLY_WARNING_WINDOW_DAYS) {
    const thresholdDate = daysFromNow(withinDays);
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

  /**
   * Validates an uploaded medicine spreadsheet (.xlsx, .xls, .csv).
   * Checks required fields, within-file duplicates, and existing database duplicates.
   */
  async validateMedicineImport(buffer: Buffer) {
    const rawRows = await parseMedicineSpreadsheet(buffer);
    if (rawRows.length === 0) {
      throw new BadRequestException(
        'The uploaded spreadsheet contains no data rows or headers were not recognized.',
      );
    }

    const existingMeds = await this.prisma.medicine.findMany({
      select: {
        genericName: true,
        strength: true,
        dosageForm: true,
      },
    });

    const existingKeys = new Set(
      existingMeds.map(
        (m) =>
          `${m.genericName.trim().toLowerCase()}|${m.strength.trim().toLowerCase()}|${m.dosageForm.trim().toLowerCase()}`,
      ),
    );

    const seenFileKeys = new Set<string>();

    const items: Array<{
      rowNum: number;
      genericName: string;
      brandName: string;
      category: string;
      strength: string;
      dosageForm: string;
      status: 'VALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING' | 'INVALID';
      reason: string;
    }> = [];

    const validItems: CreateMedicineDto[] = [];
    const rejectedItems: RejectedImportRow[] = [];

    for (const r of rawRows) {
      const genericName = r.genericName?.trim() ?? '';
      const brandName = r.brandName?.trim() ?? '';
      const category = r.category?.trim() ?? '';
      const strength = r.strength?.trim() ?? '';
      const dosageForm = r.dosageForm?.trim() ?? '';

      // Check required fields
      const missingFields: string[] = [];
      if (!genericName) missingFields.push('Generic Name');
      if (!category) missingFields.push('Category');
      if (!strength) missingFields.push('Strength');
      if (!dosageForm) missingFields.push('Dosage Form');

      if (missingFields.length > 0) {
        const reason = `Missing required field(s): ${missingFields.join(', ')}`;
        items.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'INVALID',
          reason,
        });
        rejectedItems.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'INVALID',
          reason,
        });
        continue;
      }

      const key = `${genericName.toLowerCase()}|${strength.toLowerCase()}|${dosageForm.toLowerCase()}`;

      // Check within-file duplicate
      if (seenFileKeys.has(key)) {
        const reason = 'Duplicate medicine record found in the uploaded file';
        items.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'DUPLICATE_FILE',
          reason,
        });
        rejectedItems.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'DUPLICATE_FILE',
          reason,
        });
        continue;
      }
      seenFileKeys.add(key);

      // Check existing database duplicate
      if (existingKeys.has(key)) {
        const reason =
          'Medicine with matching Generic Name, Strength, and Dosage Form already exists in Medicine Master';
        items.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'DUPLICATE_EXISTING',
          reason,
        });
        rejectedItems.push({
          rowNum: r.rowNum,
          genericName,
          brandName,
          category,
          strength,
          dosageForm,
          status: 'DUPLICATE_EXISTING',
          reason,
        });
        continue;
      }

      // Valid record
      items.push({
        rowNum: r.rowNum,
        genericName,
        brandName,
        category,
        strength,
        dosageForm,
        status: 'VALID',
        reason: 'Ready to import',
      });
      validItems.push({
        genericName,
        brandName: brandName || undefined,
        category,
        strength,
        dosageForm,
      });
    }

    const totalRows = items.length;
    const validRows = validItems.length;
    const duplicateRows = items.filter(
      (i) => i.status === 'DUPLICATE_FILE' || i.status === 'DUPLICATE_EXISTING',
    ).length;
    const invalidRows = items.filter((i) => i.status === 'INVALID').length;

    return {
      totalRows,
      validRows,
      duplicateRows,
      invalidRows,
      items,
      validItems,
      rejectedItems,
    };
  }

  /**
   * Commits validated medicines into the database.
   */
  async confirmMedicineImport(items: CreateMedicineDto[]) {
    if (!items || items.length === 0) {
      throw new BadRequestException('No valid medicine records provided for import.');
    }

    // Re-check existing medicines for concurrency safety
    const existingMeds = await this.prisma.medicine.findMany({
      select: { genericName: true, strength: true, dosageForm: true },
    });
    const existingKeys = new Set(
      existingMeds.map(
        (m) =>
          `${m.genericName.trim().toLowerCase()}|${m.strength.trim().toLowerCase()}|${m.dosageForm.trim().toLowerCase()}`,
      ),
    );

    const toInsert = items.filter((item) => {
      const key = `${item.genericName.trim().toLowerCase()}|${item.strength.trim().toLowerCase()}|${item.dosageForm.trim().toLowerCase()}`;
      return !existingKeys.has(key);
    });

    if (toInsert.length === 0) {
      return {
        importedCount: 0,
        skippedCount: items.length,
        message: 'All submitted medicines already exist in the Medicine Master.',
      };
    }

    // Create in batch inside a transaction
    await this.prisma.$transaction(
      toInsert.map((dto) =>
        this.prisma.medicine.create({
          data: {
            genericName: dto.genericName.trim(),
            brandName: dto.brandName?.trim() || null,
            category: dto.category.trim(),
            strength: dto.strength.trim(),
            dosageForm: dto.dosageForm.trim(),
          },
        }),
      ),
    );

    return {
      importedCount: toInsert.length,
      skippedCount: items.length - toInsert.length,
      message: `Successfully imported ${toInsert.length} medicine(s) into Medicine Master.`,
    };
  }
}


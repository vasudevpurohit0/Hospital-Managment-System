import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { DispenseMedicineDto } from './dto/dispense-medicine.dto';
import {
  PrescriptionStatus,
  PrescriptionItemStatus,
  StockStatus,
  StockTransactionType,
  BenefitOutcome,
} from '@prisma/client';
import { ProcurementService } from '../procurement/procurement.service';

@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private prisma: PrismaService,
    private benefitRuleService: BenefitRuleService,
    private procurementService: ProcurementService,
  ) {}

  /**
   * Get queue of signed prescriptions awaiting dispensing
   */
  async getQueue() {
    return this.prisma.prescription.findMany({
      where: {
        status: { in: [PrescriptionStatus.SIGNED, PrescriptionStatus.PARTIALLY_DISPENSED] },
      },
      include: {
        visit: {
          include: {
            employee: {
              include: {
                employmentType: true,
                patientProfile: true,
              },
            },
          },
        },
        items: true,
      },
      orderBy: { signedAt: 'asc' },
    });
  }

  /**
   * Get available medicine batches ordered by FEFO (First-Expired, First-Out).
   * EXCLUDES Expired, Quarantined, Disposed batches (FR-PHM-07 patient safety rule).
   */
  async getBatchOptions(prescriptionId: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { items: true },
    });
    if (!rx) throw new NotFoundException(`Prescription not found for ID: ${prescriptionId}`);

    const result: Record<string, any[]> = {};

    for (const item of rx.items) {
      // Extract primary medicine term (e.g. "Azithromycin" from "Azithromycin (Azee 500) - 500mg")
      const primaryTerm = item.medicineName.split(/[\(\-]/)[0].trim();
      const firstWord = primaryTerm.split(' ')[0].trim();

      const usableBatches = await this.prisma.medicineBatch.findMany({
        where: {
          OR: [
            { medicine: { genericName: { contains: primaryTerm, mode: 'insensitive' } } },
            { medicine: { genericName: { contains: firstWord, mode: 'insensitive' } } },
            { medicine: { brandName: { contains: primaryTerm, mode: 'insensitive' } } },
            { medicine: { brandName: { contains: firstWord, mode: 'insensitive' } } },
          ],
          stockStatus: {
            notIn: [StockStatus.EXPIRED, StockStatus.QUARANTINED, StockStatus.DISPOSED],
          },
          expiryDate: { gt: new Date() },
          currentStock: { gt: 0 },
        },
        include: {
          medicine: true,
        },
        orderBy: { expiryDate: 'asc' }, // FEFO enforcement (FR-PHM-03)
      });

      result[item.id] = usableBatches;
    }
    return result;
  }

  /**
   * Dispense medicines, deduct inventory, and write append-only StockTransaction audit log.
   * Restrict to Pharmacist role (FR-PHM-08).
   */
  async dispense(dto: DispenseMedicineDto, userId: string, userRole: string) {
    const normRole = userRole.toUpperCase().trim();
    if (
      !normRole.includes('PHARMACIST') &&
      !normRole.includes('SUPERADMIN') &&
      !normRole.includes('ADMIN')
    ) {
      throw new ForbiddenException(
        'Only Pharmacists and Administrators are authorized to dispense medicines.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.findUnique({
        where: { id: dto.prescriptionId },
        include: {
          items: true,
          visit: {
            include: {
              employee: {
                include: { employmentType: true, patientProfile: true },
              },
            },
          },
        },
      });

      if (!rx) throw new NotFoundException(`Prescription not found: ${dto.prescriptionId}`);

      const rxData = rx as any;
      const empTypeCode = rxData.visit?.employee?.employmentType?.code || 'PERMANENT';

      const totalItems = rxData.items.length;
      let dispensedItemCount = 0;

      for (const payloadItem of dto.items) {
        const rxItem = rxData.items.find((i: any) => i.id === payloadItem.prescriptionItemId);
        if (!rxItem) continue;

        // Single Benefit Rule call (Phase 6 engine)
        const outcome = await this.benefitRuleService.evaluate(empTypeCode);

        // Fetch batch & check FEFO/expiry
        const batch = await tx.medicineBatch.findUnique({
          where: { id: payloadItem.medicineBatchId },
        });

        if (!batch) {
          throw new BadRequestException(
            `Medicine batch not found: ${payloadItem.medicineBatchId}`,
          );
        }

        if (
          batch.stockStatus === StockStatus.EXPIRED ||
          batch.stockStatus === StockStatus.QUARANTINED ||
          batch.stockStatus === StockStatus.DISPOSED ||
          batch.expiryDate <= new Date()
        ) {
          throw new BadRequestException(
            `Batch ${batch.batchNumber} is expired or quarantined and cannot be dispensed (FR-PHM-07).`,
          );
        }

        if (batch.currentStock < payloadItem.dispenseQuantity) {
          throw new BadRequestException(
            `Insufficient stock in batch ${batch.batchNumber}. Available: ${batch.currentStock}, Requested: ${payloadItem.dispenseQuantity}`,
          );
        }

        // Atomically deduct inventory
        const updatedBatch = await tx.medicineBatch.update({
          where: { id: batch.id },
          data: {
            currentStock: batch.currentStock - payloadItem.dispenseQuantity,
          },
        });

        // Append-only audit record
        await tx.stockTransaction.create({
          data: {
            type: StockTransactionType.DISPENSE,
            medicineBatchId: updatedBatch.id,
            quantity: -payloadItem.dispenseQuantity, // Negative for dispense
            prescriptionItemId: rxItem.id,
            performedBy: userId,
          },
        });

        // Trigger automatic low stock check/requisition
        await this.procurementService.checkAndTriggerLowStockRequisition(updatedBatch.id, tx, userId);

        const newDispensed = rxItem.dispensedQuantity + payloadItem.dispenseQuantity;
        await tx.prescriptionItem.update({
          where: { id: rxItem.id },
          data: {
            dispensedQuantity: newDispensed,
            dispenseStatus: PrescriptionItemStatus.DISPENSED,
            benefitOutcome: outcome,
          },
        });

        // Same-transaction BillingTransaction creation (Phase 13)
        const isPaid = outcome === BenefitOutcome.PAID;
        const totalAmount = isPaid
          ? payloadItem.dispenseQuantity * Number(batch.issuePrice)
          : null;
        const rcptRef = isPaid
          ? `RCPT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
          : null;

        await tx.billingTransaction.create({
          data: {
            prescriptionItemId: rxItem.id,
            outcome: outcome as BenefitOutcome,
            amount: totalAmount !== null ? totalAmount : undefined,
            receiptReference: rcptRef,
          },
        });

        dispensedItemCount++;
      }

      const newRxStatus =
        dispensedItemCount >= totalItems
          ? PrescriptionStatus.CLOSED
          : PrescriptionStatus.PARTIALLY_DISPENSED;

      const updatedRx = await tx.prescription.update({
        where: { id: rx.id },
        data: { status: newRxStatus },
        include: { items: true },
      });

      this.logger.log(`✅ Dispensed prescription ${rx.id}. Status: ${newRxStatus}`);
      return {
        ...updatedRx,
        dispensedItemsCount: dispensedItemCount,
        transactionOutcome: 'COMPLETED (ESIC Benefit Applied)',
      };
    });
  }
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BillingType, ChargeStatus, PaymentMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentSequenceService, PrismaClientLike } from '../../common/sequence/document-sequence.service';
import { amountInWords } from './amount-in-words';

export interface IssueReceiptParams {
  /** Charges to attach — must all be PENDING and belong to the same visit. */
  chargeIds: string[];
  paymentMode?: PaymentMode;
  billingType?: BillingType;
  collectedById?: string;
}

/**
 * Turns a set of pending charges into a single paid receipt.
 *
 * One receipt can cover several charges raised together — a consultation and
 * a test on the same OPD visit print as one document with two line items,
 * matching the reference receipt's multi-line format, rather than the legacy
 * one-string-per-item `receiptReference`.
 */
@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  /**
   * Issues a receipt for the given charges and marks them PAID, all in one
   * transaction. Every charge must be PENDING and belong to the same visit —
   * mixing visits onto one receipt would blur which patient it is for.
   *
   * Every charge now reaches here: benefit outcome no longer settles anything
   * at charge time, so payment is always collected through a receipt.
   */
  async issue(params: IssueReceiptParams, tx?: PrismaClientLike) {
    if (!params.chargeIds.length) {
      throw new BadRequestException('At least one charge is required to issue a receipt.');
    }

    const run = async (client: PrismaClientLike) => {
      const charges = await client.chargeItem.findMany({
        where: { id: { in: params.chargeIds } },
      });

      if (charges.length !== new Set(params.chargeIds).size) {
        throw new NotFoundException('One or more charges were not found.');
      }

      const notPending = charges.filter((c) => c.status !== ChargeStatus.PENDING);
      if (notPending.length) {
        throw new BadRequestException(
          `Charge(s) ${notPending.map((c) => c.id).join(', ')} are not PENDING and cannot be receipted.`,
        );
      }

      const visitIds = new Set(charges.map((c) => c.visitId));
      if (visitIds.size > 1) {
        throw new BadRequestException('All charges on one receipt must belong to the same visit.');
      }
      const visitId = charges[0].visitId;

      const visit = await client.visit.findUnique({ where: { id: visitId } });
      if (!visit) throw new NotFoundException(`Visit not found: ${visitId}`);

      // No discount in this system: the receipt total is the straight sum of
      // each charge's quantity × rate.
      const totalAmount = charges.reduce((a, c) => a.add(c.netAmount), new Prisma.Decimal(0));

      const receiptNumber = await this.sequences.next('RECEIPT_NUMBER', client);

      const receipt = await client.receipt.create({
        data: {
          receiptNumber,
          visitId,
          employeeId: visit.employeeId,
          billingType: params.billingType ?? BillingType.GENERAL,
          grossAmount: totalAmount,
          discountAmount: new Prisma.Decimal(0),
          netAmount: totalAmount,
          amountInWords: amountInWords(totalAmount.toNumber()),
          paymentMode: params.paymentMode ?? PaymentMode.CASH,
          collectedById: params.collectedById ?? null,
        },
      });

      await client.chargeItem.updateMany({
        where: { id: { in: params.chargeIds } },
        data: { status: ChargeStatus.PAID, receiptId: receipt.id },
      });

      this.logger.log(
        `Issued receipt ${receiptNumber} for ${charges.length} charge(s), ₹${totalAmount.toFixed(2)}`,
      );

      return receipt.id;
    };

    const receiptId = tx ? await run(tx) : await this.prisma.$transaction((t) => run(t));
    // Read back through the same client that wrote it: inside a caller's
    // still-open transaction, this.prisma (a separate connection) cannot yet
    // see a row that hasn't committed.
    return this.getById(receiptId, tx);
  }

  async getById(id: string, tx?: PrismaClientLike) {
    const client = tx ?? this.prisma;
    const receipt = await client.receipt.findUnique({
      where: { id },
      include: {
        employee: {
          include: { patientProfile: true, hospitalUid: true, employmentType: true },
        },
        collectedBy: { select: { identifier: true } },
        charges: { orderBy: { createdAt: 'asc' } },
        visit: { include: { opdVisit: { include: { department: true } } } },
      },
    });
    if (!receipt) throw new NotFoundException(`Receipt not found: ${id}`);

    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      billingType: receipt.billingType,
      issuedAt: receipt.issuedAt,
      status: receipt.status,
      paymentMode: receipt.paymentMode,
      patient: {
        uhid: receipt.employee.hospitalUid?.uidCode ?? null,
        employeeId: receipt.employee.employeeId,
        name: receipt.employee.name,
        employmentType: receipt.employee.employmentType.name,
        gender: receipt.employee.patientProfile?.gender ?? null,
      },
      opdDepartment: receipt.visit.opdVisit?.department.name ?? null,
      collectedBy: receipt.collectedBy?.identifier ?? null,
      lines: receipt.charges.map((c) => ({
        description: c.description,
        category: c.categoryName,
        quantity: c.quantity.toString(),
        rate: c.unitRate.toString(),
        totalAmount: c.netAmount.toString(),
      })),
      totalAmount: receipt.netAmount.toString(),
      amountInWords: receipt.amountInWords,
    };
  }
}

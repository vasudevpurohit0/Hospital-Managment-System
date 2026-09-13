/**
 * One-time backfill: BillingTransaction (retired, pharmacy-only) → ChargeItem
 * (the unified ledger).
 *
 * Per the migration plan (§20), this is additive and non-destructive:
 * `billing_transactions` is read-only here and is not touched or dropped —
 * pharmacy.service.ts has already stopped writing to it, and it is kept as an
 * audit trail until a later, separately-decided cleanup.
 *
 * Run with:  npx ts-node -r tsconfig-paths/register prisma/seeds/backfill-billing-transactions.ts
 * Add --dry-run to report what would happen without writing anything.
 *
 * Reconstruction, per row:
 *  - visitId comes from prescriptionItem → prescription → visit (the same
 *    path BillingTransaction always implied but never stored directly).
 *  - medicineBatchId comes from the matching StockTransaction(DISPENSE) for
 *    that prescriptionItemId — BillingTransaction never stored the batch
 *    either, so this is the one place that information still exists.
 *  - quantity comes from the StockTransaction's |quantity|.
 *  - For a PAID row, `amount` WAS the net amount, so unitRate = amount /
 *    quantity, gross = amount, discount = 0 — an exact reconstruction with
 *    nothing to approximate. A legacy `receiptReference` (a plain string,
 *    pre-dating structured receipts) becomes a Receipt with that exact string
 *    as its number, so the historical reference a patient may still hold
 *    keeps meaning what it always meant.
 *  - For a FREE/COVERED row, the old schema stored no amount at all — this is
 *    the one genuine approximation the backfill makes: gross is reconstructed
 *    from the dispensed batch's current issue price (the true historical rate
 *    was never recorded), discounted in full to net = 0. This does not change
 *    what the patient was actually charged (nothing, either way) — only what
 *    value is shown as the entitlement consumed. Every such row is listed in
 *    the reconciliation report so an administrator can review the assumption.
 */
import { BenefitOutcome, ChargeStatus, PrismaClient } from '@prisma/client';
import { amountInWords } from '../../src/modules/billing/amount-in-words';

const prisma = new PrismaClient();

interface BackfillResult {
  migrated: number;
  skipped: { id: string; reason: string }[];
  approximatedRateRows: string[];
  totalNetAmountBefore: number;
  totalNetAmountAfter: number;
}

async function backfill(dryRun: boolean): Promise<BackfillResult> {
  const result: BackfillResult = {
    migrated: 0,
    skipped: [],
    approximatedRateRows: [],
    totalNetAmountBefore: 0,
    totalNetAmountAfter: 0,
  };

  const legacyRows = await prisma.billingTransaction.findMany({
    include: {
      prescriptionItem: { include: { prescription: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Skip anything already backfilled in a prior run — idempotent.
  const alreadyMigrated = new Set(
    (
      await prisma.chargeItem.findMany({
        where: { prescriptionItemId: { in: legacyRows.map((r) => r.prescriptionItemId) } },
        select: { prescriptionItemId: true },
      })
    ).map((c) => c.prescriptionItemId),
  );

  for (const row of legacyRows) {
    result.totalNetAmountBefore += row.amount ? Number(row.amount) : 0;

    if (alreadyMigrated.has(row.prescriptionItemId)) {
      result.skipped.push({ id: row.id, reason: 'already backfilled' });
      continue;
    }
    if (!row.prescriptionItem) {
      result.skipped.push({ id: row.id, reason: 'prescription item no longer exists' });
      continue;
    }

    const visitId = row.prescriptionItem.prescription.visitId;

    const dispense = await prisma.stockTransaction.findFirst({
      where: { prescriptionItemId: row.prescriptionItemId, type: 'DISPENSE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!dispense) {
      result.skipped.push({
        id: row.id,
        reason: 'no matching StockTransaction — cannot determine the dispensed batch',
      });
      continue;
    }

    const quantity = Math.abs(dispense.quantity);
    if (quantity <= 0) {
      result.skipped.push({ id: row.id, reason: 'stock transaction quantity is not usable' });
      continue;
    }

    const isPaid = row.outcome === BenefitOutcome.PAID && row.amount !== null;

    let unitRate: number;
    let grossAmount: number;
    let discountAmount: number;
    let netAmount: number;

    if (isPaid) {
      // Exact reconstruction: `amount` already was the net amount.
      netAmount = Number(row.amount);
      unitRate = netAmount / quantity;
      grossAmount = netAmount;
      discountAmount = 0;
    } else {
      // Approximation: the old schema recorded no amount for FREE/COVERED.
      // Reconstruct value from the batch's current issue price so the ledger
      // shows what care was worth, not a fabricated charge to the patient.
      const batch = await prisma.medicineBatch.findUnique({ where: { id: dispense.medicineBatchId } });
      const rate = batch ? Number(batch.issuePrice) : 0;
      unitRate = rate;
      grossAmount = rate * quantity;
      discountAmount = grossAmount;
      netAmount = 0;
      result.approximatedRateRows.push(row.id);
    }

    result.totalNetAmountAfter += netAmount;

    if (dryRun) {
      result.migrated++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const charge = await tx.chargeItem.create({
        data: {
          visitId,
          prescriptionItemId: row.prescriptionItemId,
          medicineBatchId: dispense.medicineBatchId,
          description: row.prescriptionItem!.medicineName,
          categoryName: 'Pharmacy',
          quantity,
          unitRate,
          grossAmount,
          discountAmount,
          netAmount,
          benefitOutcome: row.outcome,
          status: isPaid ? ChargeStatus.PENDING : ChargeStatus.PAID,
          createdAt: row.createdAt, // preserve the real historical date
        },
      });

      if (isPaid && row.receiptReference) {
        // The legacy reference was a plain string, not a structured receipt —
        // preserved verbatim as this receipt's number rather than reissued
        // under the new RCPT/YYYY/NNNNNN scheme, so a reference a patient may
        // still hold keeps meaning what it always meant.
        const receipt = await tx.receipt.create({
          data: {
            receiptNumber: row.receiptReference,
            visitId,
            employeeId: (await tx.visit.findUniqueOrThrow({ where: { id: visitId } })).employeeId,
            grossAmount,
            discountAmount: 0,
            netAmount,
            amountInWords: amountInWords(netAmount),
            issuedAt: row.createdAt,
          },
        });
        await tx.chargeItem.update({
          where: { id: charge.id },
          data: { status: ChargeStatus.PAID, receiptId: receipt.id },
        });
      }
    });

    result.migrated++;
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`🔄 Backfilling billing_transactions → charge_items ${dryRun ? '(DRY RUN)' : ''}`);

  const result = await backfill(dryRun);

  console.log('');
  console.log('── Reconciliation ──');
  console.log(`  Rows migrated:            ${result.migrated}`);
  console.log(`  Rows skipped:             ${result.skipped.length}`);
  for (const s of result.skipped) console.log(`    - ${s.id}: ${s.reason}`);
  console.log(`  Net amount before (PAID rows only, as the old schema recorded): ₹${result.totalNetAmountBefore.toFixed(2)}`);
  console.log(`  Net amount after  (PAID rows only, should match exactly):       ₹${result.totalNetAmountAfter.toFixed(2)}`);
  if (result.totalNetAmountBefore !== result.totalNetAmountAfter) {
    console.error('  ❌ MISMATCH — investigate before relying on this backfill.');
    process.exitCode = 1;
  } else {
    console.log('  ✅ PAID-row totals reconcile exactly.');
  }
  if (result.approximatedRateRows.length) {
    console.log('');
    console.log(
      `  ⓘ ${result.approximatedRateRows.length} FREE/COVERED row(s) had their gross value ` +
        `reconstructed from the batch's CURRENT issue price (the old schema recorded no amount ` +
        `for these). The patient was charged ₹0 either way; only the displayed entitlement value ` +
        `is an approximation. Row ids: ${result.approximatedRateRows.join(', ')}`,
    );
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('❌ Backfill error:', e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

export { backfill };

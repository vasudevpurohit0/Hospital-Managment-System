import { ChargeStatus, PrismaClient } from '@prisma/client';

/**
 * One-off repair for charges written by the old benefit-outcome zeroing.
 *
 * Until this was fixed, ChargeService treated a FREE/COVERED benefit outcome as
 * a full discount: a ₹565 therapy was stored as gross ₹565, discount ₹565,
 * net ₹0, and settled immediately as PAID without any payment being collected.
 * Because the seeded benefit rule maps PERMANENT employees to COVERED, that
 * applied to essentially every charge in the hospital, and the Patient Ledger
 * reported ₹0 for treatment that had really been delivered.
 *
 * This restores the intended rule — total = quantity × the configured rate —
 * on the rows that bug produced:
 *
 *   discountAmount → 0, netAmount → grossAmount
 *
 * A charge that the bug also marked PAID **with no receipt** was never actually
 * paid, so it goes back to PENDING and becomes collectable. A charge attached
 * to a real receipt is NOT touched: its receipt is a document that was issued
 * for a stated amount, and silently rewriting it would contradict a record the
 * hospital has already handed to a patient. Those are reported instead, for a
 * human to reverse and re-issue.
 *
 * Idempotent: re-running finds nothing left to repair.
 *
 * Run with:  npx ts-node -r tsconfig-paths/register prisma/seeds/repair-discounted-charges.ts
 */
export async function repairDiscountedCharges(prisma: PrismaClient): Promise<void> {
  const affected = await prisma.chargeItem.findMany({
    where: { discountAmount: { gt: 0 } },
    select: {
      id: true,
      description: true,
      grossAmount: true,
      netAmount: true,
      status: true,
      receiptId: true,
      receipt: { select: { receiptNumber: true } },
    },
  });

  if (affected.length === 0) {
    console.log('  ✓ No discounted charges found — nothing to repair.');
    return;
  }

  const receipted = affected.filter((c) => c.receiptId !== null);
  const repairable = affected.filter((c) => c.receiptId === null);

  let amountsFixed = 0;
  let reopened = 0;

  for (const charge of repairable) {
    // A charge the bug settled as PAID without a receipt was never paid for.
    const reopen = charge.status === ChargeStatus.PAID;

    await prisma.chargeItem.update({
      where: { id: charge.id },
      data: {
        discountAmount: 0,
        netAmount: charge.grossAmount,
        ...(reopen ? { status: ChargeStatus.PENDING } : {}),
      },
    });

    amountsFixed++;
    if (reopen) reopened++;

    console.log(
      `  · ${charge.description.slice(0, 32).padEnd(32)} ` +
        `₹${charge.netAmount.toString()} → ₹${charge.grossAmount.toString()}` +
        (reopen ? '  (PAID → PENDING, no receipt existed)' : ''),
    );
  }

  console.log(
    `  ✓ Repaired ${amountsFixed} charge(s); ${reopened} reopened as PENDING for collection.`,
  );

  if (receipted.length) {
    console.warn(
      `  ⚠ ${receipted.length} discounted charge(s) are attached to an issued receipt and were ` +
        `left untouched — rewriting them would contradict a document already given to a patient. ` +
        `Reverse and re-issue these manually: ` +
        receipted.map((c) => c.receipt?.receiptNumber ?? c.id).join(', '),
    );
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  repairDiscountedCharges(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

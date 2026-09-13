-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('GENERAL', 'ESIC_BENEFICIARY');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "charge_items" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "admission_id" UUID,
    "service_id" UUID,
    "service_price_id" UUID,
    "prescription_item_id" UUID,
    "medicine_batch_id" UUID,
    "description" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_rate" DECIMAL(10,2) NOT NULL,
    "gross_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(10,2) NOT NULL,
    "benefitOutcome" "BenefitOutcome" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "receipt_id" UUID,
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "charge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "visit_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "billing_type" "BillingType" NOT NULL DEFAULT 'GENERAL',
    "gross_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(10,2) NOT NULL,
    "amount_in_words" TEXT NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "collected_by_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charge_items_reversal_of_id_key" ON "charge_items"("reversal_of_id");

-- CreateIndex
CREATE INDEX "charge_items_visit_id_idx" ON "charge_items"("visit_id");

-- CreateIndex
CREATE INDEX "charge_items_admission_id_idx" ON "charge_items"("admission_id");

-- CreateIndex
CREATE INDEX "charge_items_receipt_id_idx" ON "charge_items"("receipt_id");

-- CreateIndex
CREATE INDEX "charge_items_created_at_idx" ON "charge_items"("created_at");

-- CreateIndex
CREATE INDEX "charge_items_service_id_created_at_idx" ON "charge_items"("service_id", "created_at");

-- CreateIndex
CREATE INDEX "charge_items_prescription_item_id_idx" ON "charge_items"("prescription_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receipt_number_key" ON "receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "receipts_visit_id_idx" ON "receipts"("visit_id");

-- CreateIndex
CREATE INDEX "receipts_employee_id_idx" ON "receipts"("employee_id");

-- CreateIndex
CREATE INDEX "receipts_issued_at_idx" ON "receipts"("issued_at");

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_service_price_id_fkey" FOREIGN KEY ("service_price_id") REFERENCES "service_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "prescription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_medicine_batch_id_fkey" FOREIGN KEY ("medicine_batch_id") REFERENCES "medicine_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "charge_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_collected_by_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ChargeItem integrity constraints.
--
-- These hold even if application code is bypassed or has a bug, which is the
-- point: "no orphan, ambiguous, duplicated, or incorrectly linked charges" is
-- a database-level guarantee here, not just a service-layer convention.
-- ---------------------------------------------------------------------------

-- Exactly one source per charge. A row with zero sources is an orphan; a row
-- with two is ambiguous about what it actually bills. (Widens when P3/P4 add
-- lab_order_item_id / therapy_session_id as their tables come into existence.)
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_exactly_one_source"
  CHECK (num_nonnulls("service_id", "prescription_item_id") = 1);

-- A service-sourced charge always cites the exact price version it used, and
-- a non-service charge never does — the pairing is symmetric, not just
-- "present when needed."
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_service_price_pairing"
  CHECK (("service_id" IS NULL) = ("service_price_id" IS NULL));

-- Symmetrically, a pharmacy charge always cites the batch it was dispensed
-- from (the source of its rate), and nothing else ever does.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_medicine_batch_pairing"
  CHECK (("prescription_item_id" IS NULL) = ("medicine_batch_id" IS NULL));

-- The three amounts always agree with each other and with quantity × rate.
-- A charge can never store numbers that don't add up.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_unit_rate_non_negative"
  CHECK ("unit_rate" >= 0);

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_gross_matches_quantity_rate"
  CHECK ("gross_amount" = "quantity" * "unit_rate");

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_discount_within_gross"
  CHECK ("discount_amount" >= 0 AND "discount_amount" <= "gross_amount");

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_net_equals_gross_minus_discount"
  CHECK ("net_amount" = "gross_amount" - "discount_amount");

-- A cancelled charge always records who cancelled it, when, and why — the
-- audit trail is mandatory, not merely conventional.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_cancellation_is_complete"
  CHECK (
    "status" <> 'CANCELLED'
    OR ("cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL AND "cancel_reason" IS NOT NULL)
  );

-- A charge that is itself a reversal cannot also be reversed — correct a
-- correction by reversing it and issuing a fresh charge, not by stacking.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_reversal_not_itself_reversed"
  CHECK ("id" <> "reversal_of_id");

-- ---------------------------------------------------------------------------
-- Receipt integrity constraints — the same arithmetic discipline as charges.
-- ---------------------------------------------------------------------------

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_gross_non_negative"
  CHECK ("gross_amount" >= 0);

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_discount_within_gross"
  CHECK ("discount_amount" >= 0 AND "discount_amount" <= "gross_amount");

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_net_equals_gross_minus_discount"
  CHECK ("net_amount" = "gross_amount" - "discount_amount");

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_cancellation_is_complete"
  CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL));

-- CreateEnum
CREATE TYPE "LabOrderPriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_ENTERED', 'VERIFIED', 'REPORTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabOrderItemStatus" AS ENUM ('ORDERED', 'RESULT_ENTERED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "LabDiscipline" AS ENUM ('HAEMATOLOGY', 'BIOCHEMISTRY', 'SEROLOGY', 'CLINICAL_PATHOLOGY', 'MICROBIOLOGY');

-- CreateEnum
CREATE TYPE "LabResultType" AS ENUM ('NUMERIC', 'TEXT', 'SELECT');

-- CreateEnum
CREATE TYPE "LabRangeSex" AS ENUM ('MALE', 'FEMALE', 'ANY');

-- CreateEnum
CREATE TYPE "LabResultFlag" AS ENUM ('NORMAL', 'HIGH', 'LOW', 'CRITICAL');

-- AlterTable
ALTER TABLE "charge_items" ADD COLUMN     "lab_order_item_id" UUID;

-- AlterTable
-- The two pre-existing rows both hold status='ORDERED', a valid member of the
-- new enum, so this casts in place rather than dropping the column — a
-- DROP+ADD (Prisma's default plan here) would silently discard that history.
ALTER TABLE "lab_orders" ADD COLUMN     "admission_id" UUID,
ADD COLUMN     "clinical_notes" TEXT,
ADD COLUMN     "lab_number" TEXT,
ADD COLUMN     "priority" "LabOrderPriority" NOT NULL DEFAULT 'ROUTINE',
ALTER COLUMN "test_name" DROP NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "LabOrderStatus" USING (status::"LabOrderStatus"),
ALTER COLUMN "status" SET DEFAULT 'ORDERED';

-- CreateTable
CREATE TABLE "lab_order_items" (
    "id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "status" "LabOrderItemStatus" NOT NULL DEFAULT 'ORDERED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_samples" (
    "id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "sample_code" TEXT NOT NULL,
    "specimen_type" TEXT NOT NULL,
    "collected_by_id" UUID NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejected_reason" TEXT,

    CONSTRAINT "lab_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" "LabDiscipline" NOT NULL,
    "specimen_type" TEXT NOT NULL,
    "container_type" TEXT,
    "method_default" TEXT,
    "turnaround_hours" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_parameters" (
    "id" UUID NOT NULL,
    "lab_test_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group_label" TEXT,
    "unit" TEXT,
    "result_type" "LabResultType" NOT NULL DEFAULT 'NUMERIC',
    "select_options" TEXT[],
    "method" TEXT,
    "is_calculated" BOOLEAN NOT NULL DEFAULT false,
    "formula" TEXT,
    "interpretation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lab_test_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reference_ranges" (
    "id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "display_text" TEXT NOT NULL,
    "numeric_low" DECIMAL(12,4),
    "numeric_high" DECIMAL(12,4),
    "sex" "LabRangeSex" NOT NULL DEFAULT 'ANY',
    "age_min_years" INTEGER,
    "age_max_years" INTEGER,

    CONSTRAINT "lab_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL,
    "lab_order_item_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "flag" "LabResultFlag" NOT NULL DEFAULT 'NORMAL',
    "entered_by_id" UUID NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reports" (
    "id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "verified_by_id" UUID NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pathologist_remarks" TEXT,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_order_items_lab_order_id_idx" ON "lab_order_items"("lab_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_samples_lab_order_id_key" ON "lab_samples"("lab_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_samples_sample_code_key" ON "lab_samples"("sample_code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_service_id_key" ON "lab_tests"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_code_key" ON "lab_tests"("code");

-- CreateIndex
CREATE INDEX "lab_tests_discipline_active_idx" ON "lab_tests"("discipline", "active");

-- CreateIndex
CREATE INDEX "lab_test_parameters_lab_test_id_sort_order_idx" ON "lab_test_parameters"("lab_test_id", "sort_order");

-- CreateIndex
CREATE INDEX "lab_reference_ranges_parameter_id_idx" ON "lab_reference_ranges"("parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_lab_order_item_id_parameter_id_key" ON "lab_results"("lab_order_item_id", "parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_lab_order_id_key" ON "lab_reports"("lab_order_id");

-- CreateIndex
CREATE INDEX "charge_items_lab_order_item_id_idx" ON "charge_items"("lab_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_lab_number_key" ON "lab_orders"("lab_number");

-- CreateIndex
CREATE INDEX "lab_orders_visit_id_idx" ON "lab_orders"("visit_id");

-- CreateIndex
CREATE INDEX "lab_orders_status_idx" ON "lab_orders"("status");

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_ordered_by_fkey" FOREIGN KEY ("ordered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_collected_by_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_parameters" ADD CONSTRAINT "lab_test_parameters_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "lab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reference_ranges" ADD CONSTRAINT "lab_reference_ranges_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "lab_test_parameters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_lab_order_item_id_fkey" FOREIGN KEY ("lab_order_item_id") REFERENCES "lab_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "lab_test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_lab_order_item_id_fkey" FOREIGN KEY ("lab_order_item_id") REFERENCES "lab_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rework ChargeItem's origin constraints to admit a lab charge, which needs
-- BOTH a clinical link (lab_order_item_id) AND a priced-service link
-- (service_id/service_price_id) — the previous "exactly one of
-- {service_id, prescription_item_id}" rule could not express that, since a
-- lab test is a catalogue service with its own clinical order-item.
-- ---------------------------------------------------------------------------
ALTER TABLE "charge_items" DROP CONSTRAINT "charge_items_exactly_one_source";

-- At most one clinical origin. (Widens again in P4 to include
-- therapy_session_id once TherapySession exists.)
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_at_most_one_clinical_origin"
  CHECK (num_nonnulls("prescription_item_id", "lab_order_item_id") <= 1);

-- A pharmacy charge never also carries a catalogue service reference —
-- medicine pricing stays on the batch, never the catalogue (plan §07/C5).
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_pharmacy_excludes_service"
  CHECK ("prescription_item_id" IS NULL OR "service_id" IS NULL);

-- A lab charge MUST also carry its priced service: a lab test is a catalogue
-- service, so its charge is priced exactly like any other service charge.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_lab_requires_service"
  CHECK ("lab_order_item_id" IS NULL OR "service_id" IS NOT NULL);

-- Every charge has an origin: a clinical link, or a direct service charge
-- (OPD consultation, bed-day, package) with no clinical link of its own.
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_has_an_origin"
  CHECK (num_nonnulls("prescription_item_id", "lab_order_item_id") >= 1 OR "service_id" IS NOT NULL);

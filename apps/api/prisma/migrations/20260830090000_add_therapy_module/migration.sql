-- CreateEnum
CREATE TYPE "TherapyCourseStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TherapySessionStatus" AS ENUM ('SCHEDULED', 'PERFORMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "charge_items" ADD COLUMN     "therapy_session_id" UUID;

-- CreateTable
CREATE TABLE "therapy_courses" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "admission_id" UUID,
    "service_id" UUID NOT NULL,
    "charge_item_id" UUID,
    "planned_sessions" INTEGER NOT NULL,
    "status" "TherapyCourseStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_sessions" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "admission_id" UUID,
    "service_id" UUID NOT NULL,
    "course_id" UUID,
    "session_number" INTEGER NOT NULL DEFAULT 1,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_at" TIMESTAMP(3),
    "performed_by_id" UUID,
    "status" "TherapySessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "therapy_courses_charge_item_id_key" ON "therapy_courses"("charge_item_id");

-- CreateIndex
CREATE INDEX "therapy_courses_visit_id_idx" ON "therapy_courses"("visit_id");

-- CreateIndex
CREATE INDEX "therapy_sessions_visit_id_idx" ON "therapy_sessions"("visit_id");

-- CreateIndex
CREATE INDEX "therapy_sessions_course_id_idx" ON "therapy_sessions"("course_id");

-- CreateIndex
CREATE INDEX "charge_items_therapy_session_id_idx" ON "charge_items"("therapy_session_id");

-- AddForeignKey
ALTER TABLE "therapy_courses" ADD CONSTRAINT "therapy_courses_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_courses" ADD CONSTRAINT "therapy_courses_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_courses" ADD CONSTRAINT "therapy_courses_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_courses" ADD CONSTRAINT "therapy_courses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "therapy_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_therapy_session_id_fkey" FOREIGN KEY ("therapy_session_id") REFERENCES "therapy_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Widen ChargeItem's origin rules to admit a per-sitting therapy/procedure
-- charge (therapy_session_id), which — like a lab charge — needs BOTH the
-- clinical link and the priced service. A course package's one opening
-- charge deliberately does NOT set therapy_session_id: it bills as a direct
-- service charge, the same shape as an OPD consultation.
-- ---------------------------------------------------------------------------
ALTER TABLE "charge_items" DROP CONSTRAINT "charge_items_at_most_one_clinical_origin";
ALTER TABLE "charge_items" DROP CONSTRAINT "charge_items_has_an_origin";

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_at_most_one_clinical_origin"
  CHECK (num_nonnulls("prescription_item_id", "lab_order_item_id", "therapy_session_id") <= 1);

ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_has_an_origin"
  CHECK (num_nonnulls("prescription_item_id", "lab_order_item_id", "therapy_session_id") >= 1 OR "service_id" IS NOT NULL);

-- A therapy/procedure session charge MUST also carry its priced service.
-- (A pharmacy charge can never also carry a therapy_session_id — that's
-- already guaranteed by charge_items_at_most_one_clinical_origin above, so
-- no separate exclusion constraint is needed here, unlike the service_id
-- case, which sits outside that mutual-exclusion group.)
ALTER TABLE "charge_items"
  ADD CONSTRAINT "charge_items_therapy_requires_service"
  CHECK ("therapy_session_id" IS NULL OR "service_id" IS NOT NULL);

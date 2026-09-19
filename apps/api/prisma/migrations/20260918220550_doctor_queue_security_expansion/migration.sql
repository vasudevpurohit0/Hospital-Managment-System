-- CreateEnum
CREATE TYPE "OpdVisitStatus" AS ENUM ('WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW', 'SKIPPED', 'CANCELLED', 'TRANSFERRED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "consultation_duration_minutes" INTEGER,
ADD COLUMN     "daily_capacity" INTEGER,
ADD COLUMN     "professional_email" TEXT,
ADD COLUMN     "professional_phone" TEXT,
ADD COLUMN     "signature_ref" TEXT,
ADD COLUMN     "sub_specialty" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "opd_visits" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "assigned_room_label" TEXT,
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "consultation_started_at" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queue_notes" TEXT,
ADD COLUMN     "queue_position" INTEGER,
ADD COLUMN     "skip_reason" TEXT,
ADD COLUMN     "status" "OpdVisitStatus" NOT NULL DEFAULT 'WAITING',
ADD COLUMN     "transfer_reason" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "doctor_credentials" (
    "id" UUID NOT NULL,
    "doctor_profile_id" UUID NOT NULL,
    "credential_type" TEXT NOT NULL,
    "license_number" TEXT,
    "issuing_body" TEXT,
    "qualification_name" TEXT,
    "expiry_date" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_departments" (
    "id" UUID NOT NULL,
    "doctor_profile_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "doctor_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "id" UUID NOT NULL,
    "doctor_profile_id" UUID NOT NULL,
    "day_of_week" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "room_label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_leaves" (
    "id" UUID NOT NULL,
    "doctor_profile_id" UUID NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "substitute_doctor_profile_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_room_assignments" (
    "id" UUID NOT NULL,
    "doctor_profile_id" UUID NOT NULL,
    "room_label" TEXT NOT NULL,
    "department_id" UUID,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "doctor_room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_credentials_doctor_profile_id_idx" ON "doctor_credentials"("doctor_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_departments_doctor_profile_id_department_id_key" ON "doctor_departments"("doctor_profile_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_schedules_doctor_profile_id_day_of_week_key" ON "doctor_schedules"("doctor_profile_id", "day_of_week");

-- CreateIndex
CREATE INDEX "doctor_leaves_doctor_profile_id_idx" ON "doctor_leaves"("doctor_profile_id");

-- CreateIndex
CREATE INDEX "doctor_room_assignments_doctor_profile_id_idx" ON "doctor_room_assignments"("doctor_profile_id");

-- CreateIndex
CREATE INDEX "opd_visits_doctor_id_status_idx" ON "opd_visits"("doctor_id", "status");

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_leaves" ADD CONSTRAINT "doctor_leaves_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_leaves" ADD CONSTRAINT "doctor_leaves_substitute_doctor_profile_id_fkey" FOREIGN KEY ("substitute_doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_room_assignments" ADD CONSTRAINT "doctor_room_assignments_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_room_assignments" ADD CONSTRAINT "doctor_room_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


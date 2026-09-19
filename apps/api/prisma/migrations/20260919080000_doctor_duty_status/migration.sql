-- CreateEnum
CREATE TYPE "DoctorDutyStatus" AS ENUM ('OFF_DUTY', 'AVAILABLE', 'ON_BREAK');

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "duty_status" "DoctorDutyStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "duty_status_changed_at" TIMESTAMP(3),
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "checked_out_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "doctor_profiles" DROP COLUMN "timing",
ADD COLUMN     "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "weekly_schedule" JSONB;

-- AddForeignKey
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


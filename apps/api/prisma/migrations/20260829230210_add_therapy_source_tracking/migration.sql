-- CreateEnum
CREATE TYPE "TherapySource" AS ENUM ('DIRECT', 'OPD', 'IPD');

-- AlterEnum
ALTER TYPE "TherapySessionStatus" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "therapy_courses" ADD COLUMN     "source" "TherapySource" NOT NULL;

-- AlterTable
ALTER TABLE "therapy_sessions" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "source" "TherapySource" NOT NULL;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

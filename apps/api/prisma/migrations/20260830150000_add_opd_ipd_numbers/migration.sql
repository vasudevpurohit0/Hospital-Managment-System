-- AlterTable
ALTER TABLE "admissions" ADD COLUMN     "admission_number" TEXT;

-- AlterTable
ALTER TABLE "opd_visits" ADD COLUMN     "opd_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "admissions_admission_number_key" ON "admissions"("admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "opd_visits_opd_number_key" ON "opd_visits"("opd_number");


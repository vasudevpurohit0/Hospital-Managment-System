-- Lets a doctor prescribe a medicine that is not in the hospital's Medicine
-- catalogue ("Custom Medicine"). Existing rows default to INVENTORY, which
-- preserves their current meaning exactly (medicineName came from the
-- inventory dropdown for every row created before this migration).
-- CreateEnum
CREATE TYPE "PrescriptionItemMedicineType" AS ENUM ('INVENTORY', 'CUSTOM');

-- AlterTable
ALTER TABLE "prescription_items" ADD COLUMN     "medicine_type" "PrescriptionItemMedicineType" NOT NULL DEFAULT 'INVENTORY';

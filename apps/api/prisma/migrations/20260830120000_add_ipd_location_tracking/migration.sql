-- AlterTable
ALTER TABLE "wards" ADD COLUMN     "building" TEXT DEFAULT 'Main Hospital',
ADD COLUMN     "floor" TEXT;

-- CreateTable
CREATE TABLE "patient_location_history" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "from_ward_id" UUID,
    "from_room_id" UUID,
    "from_bed_id" UUID,
    "to_ward_id" UUID NOT NULL,
    "to_room_id" UUID NOT NULL,
    "to_bed_id" UUID NOT NULL,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moved_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "patient_location_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_location_history_admission_id_moved_at_idx" ON "patient_location_history"("admission_id", "moved_at");

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_from_ward_id_fkey" FOREIGN KEY ("from_ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_from_room_id_fkey" FOREIGN KEY ("from_room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_from_bed_id_fkey" FOREIGN KEY ("from_bed_id") REFERENCES "beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_to_ward_id_fkey" FOREIGN KEY ("to_ward_id") REFERENCES "wards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_to_room_id_fkey" FOREIGN KEY ("to_room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_to_bed_id_fkey" FOREIGN KEY ("to_bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_location_history" ADD CONSTRAINT "patient_location_history_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_name_period_key_key" ON "document_sequences"("name", "period_key");

-- CreateIndex
CREATE INDEX "opd_visits_doctor_id_idx" ON "opd_visits"("doctor_id");

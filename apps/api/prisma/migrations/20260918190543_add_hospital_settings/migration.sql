-- CreateTable
CREATE TABLE "hospital_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "working_hours_start" TEXT NOT NULL,
    "working_hours_end" TEXT NOT NULL,
    "working_days" TEXT[],
    "currency" TEXT NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL,
    "billing_prefix" TEXT NOT NULL,
    "notify_on_admission" BOOLEAN NOT NULL,
    "notify_on_discharge" BOOLEAN NOT NULL,
    "notify_on_low_stock" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hospital_settings_pkey" PRIMARY KEY ("id")
);


-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('CONSULTATION', 'TEST', 'THERAPY', 'PROCEDURE', 'PACKAGE', 'BED_DAY', 'CARE_PER_DAY');

-- CreateEnum
CREATE TYPE "ServiceApplicability" AS ENUM ('OPD', 'IPD', 'BOTH');

-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('SITTING', 'SESSION', 'DAY', 'COURSE', 'TEST', 'VISIT');

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "service_type" "ServiceType" NOT NULL,
    "applicability" "ServiceApplicability" NOT NULL DEFAULT 'BOTH',
    "unit" "ServiceUnit" NOT NULL DEFAULT 'SITTING',
    "description" TEXT,
    "duration_minutes" INTEGER,
    "course_duration_days" INTEGER,
    "source_reference" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_package_items" (
    "id" UUID NOT NULL,
    "package_service_id" UUID NOT NULL,
    "component_service_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_prices" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_code_key" ON "service_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_name_key" ON "service_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_category_id_active_idx" ON "services"("category_id", "active");

-- CreateIndex
CREATE INDEX "services_service_type_active_idx" ON "services"("service_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_package_items_package_service_id_component_service__key" ON "service_package_items"("package_service_id", "component_service_id");

-- CreateIndex
CREATE INDEX "service_prices_service_id_effective_from_idx" ON "service_prices"("service_id", "effective_from");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_package_service_id_fkey" FOREIGN KEY ("package_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_component_service_id_fkey" FOREIGN KEY ("component_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- At most one open (currently effective) price version per service.
--
-- Prisma cannot express a partial unique index, but this is the guarantee that
-- makes "old bills never change" safe under concurrency: two administrators
-- repricing the same service simultaneously cannot both leave an open version,
-- which would make the current rate ambiguous. The loser's transaction fails
-- and is retried against the new state.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "service_prices_one_open_per_service"
  ON "service_prices" ("service_id")
  WHERE "effective_to" IS NULL;

-- A version cannot end before it starts.
ALTER TABLE "service_prices"
  ADD CONSTRAINT "service_prices_period_valid"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- Rates are never negative.
ALTER TABLE "service_prices"
  ADD CONSTRAINT "service_prices_amount_non_negative"
  CHECK ("amount" >= 0);

-- A package cannot contain itself.
ALTER TABLE "service_package_items"
  ADD CONSTRAINT "service_package_items_no_self_reference"
  CHECK ("package_service_id" <> "component_service_id");

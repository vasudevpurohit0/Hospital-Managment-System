-- The previous migration left this column unmapped, so Prisma named it
-- camelCase while every other column in the schema is snake_case. The table
-- is brand new and empty, so a straight rename is safe and avoids losing the
-- column's position/constraints the way DROP+ADD would.
ALTER TABLE "charge_items" RENAME COLUMN "benefitOutcome" TO "benefit_outcome";

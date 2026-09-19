-- F-28: AWAITING_BED and DISCHARGE_APPROVED were never set by any service
-- code (allocateBed() moves REQUESTED/ELIGIBILITY_CHECKED straight to
-- UNDER_TREATMENT; discharge() has no separate approval step before
-- DISCHARGED) -- dead enum values removed. Safe to run unconditionally:
-- since nothing ever wrote these values, no existing "admissions" row can
-- hold either of them.
BEGIN;
CREATE TYPE "AdmissionStatus_new" AS ENUM ('REQUESTED', 'ELIGIBILITY_CHECKED', 'ALLOCATED', 'UNDER_TREATMENT', 'DISCHARGED');
ALTER TABLE "admissions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "admissions" ALTER COLUMN "status" TYPE "AdmissionStatus_new" USING ("status"::text::"AdmissionStatus_new");
ALTER TYPE "AdmissionStatus" RENAME TO "AdmissionStatus_old";
ALTER TYPE "AdmissionStatus_new" RENAME TO "AdmissionStatus";
DROP TYPE "AdmissionStatus_old";
ALTER TABLE "admissions" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';
COMMIT;

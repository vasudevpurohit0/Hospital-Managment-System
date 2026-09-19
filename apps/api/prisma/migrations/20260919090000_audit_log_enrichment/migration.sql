-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "browser" TEXT,
ADD COLUMN     "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "device" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "os" TEXT,
ADD COLUMN     "severity" "AuditSeverity" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS';

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");

-- CreateIndex
CREATE INDEX "audit_logs_severity_idx" ON "audit_logs"("severity");


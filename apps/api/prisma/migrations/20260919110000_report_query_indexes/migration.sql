-- Supports reports.service.ts's outstandingReportCsv() (WHERE status = 'PENDING'
-- ORDER BY created_at) and billingReportCsv() (WHERE status != 'CANCELLED'
-- ORDER BY created_at), and patientRegisterCsv() (WHERE/ORDER BY
-- registration_date) -- all already `take`-capped (Fix 13), this is the
-- "index-back" half of the same audit finding.
-- CreateIndex
CREATE INDEX "charge_items_status_created_at_idx" ON "charge_items"("status", "created_at");

-- CreateIndex
CREATE INDEX "employees_registration_date_idx" ON "employees"("registration_date");

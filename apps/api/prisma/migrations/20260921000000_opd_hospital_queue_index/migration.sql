-- Backs OpdService.getHospitalQueue(), which the hospital-wide public OPD
-- display uses to read every department's active queue in a single query
-- (WHERE status IN (...), no department_id equality). The existing
-- [department_id, created_at] index doesn't help that access pattern.
-- CreateIndex
CREATE INDEX "opd_visits_status_department_id_idx" ON "opd_visits"("status", "department_id");

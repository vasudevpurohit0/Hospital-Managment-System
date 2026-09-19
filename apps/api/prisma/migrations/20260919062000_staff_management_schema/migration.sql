-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "designation" TEXT;

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day_of_week" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_shifts_user_id_day_of_week_key" ON "staff_shifts"("user_id", "day_of_week");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only enforcement: audit_logs may only ever be inserted into. This
-- holds regardless of which DB role the application connects as (unlike a
-- REVOKE on a specific role name, which would need to be re-applied per
-- environment) and protects against a future application bug, not just
-- against the current API surface (which already exposes no update/delete
-- route for this table).
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

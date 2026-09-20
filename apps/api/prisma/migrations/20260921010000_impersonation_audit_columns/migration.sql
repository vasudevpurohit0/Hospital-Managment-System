-- Backs the new user-impersonation feature's audit trail: every audit_logs
-- row written while an admin is impersonating another user keeps
-- actor_user_id/actor_role as the IMPERSONATED user (who actually performed
-- the action) and records who was impersonating them here, so no action
-- taken during an impersonation session can appear to have been performed
-- independently by the target. No FK: the impersonator may be a
-- PlatformUser (Super Admin), whose id does not exist in this tenant schema.
-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "impersonator_actor_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "impersonator_role_label" TEXT;

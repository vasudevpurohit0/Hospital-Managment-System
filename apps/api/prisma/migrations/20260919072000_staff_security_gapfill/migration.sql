-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('ACTIVATION', 'ACTIVATION_RESEND', 'TEMP_PASSWORD');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED', 'DEV_LOGGED');

-- AlterTable
ALTER TABLE "hospital_settings" ADD COLUMN     "send_temporary_password_by_email" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "temp_password_expires_at" TIMESTAMP(3),
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "staff_department_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "staff_department_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "sent_by_user_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_department_assignments_user_id_department_id_key" ON "staff_department_assignments"("user_id", "department_id");

-- CreateIndex
CREATE INDEX "email_logs_to_email_idx" ON "email_logs"("to_email");

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");

-- AddForeignKey
ALTER TABLE "staff_department_assignments" ADD CONSTRAINT "staff_department_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_department_assignments" ADD CONSTRAINT "staff_department_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

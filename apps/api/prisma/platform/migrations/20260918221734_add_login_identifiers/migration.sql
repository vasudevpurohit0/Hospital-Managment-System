-- CreateTable
CREATE TABLE "login_identifiers" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "hospital_id" UUID,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_login_activity" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_login_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_identifiers_identifier_key" ON "login_identifiers"("identifier");

-- CreateIndex
CREATE INDEX "login_identifiers_hospital_id_idx" ON "login_identifiers"("hospital_id");

-- CreateIndex
CREATE INDEX "platform_login_activity_identifier_created_at_idx" ON "platform_login_activity"("identifier", "created_at");

-- AddForeignKey
ALTER TABLE "login_identifiers" ADD CONSTRAINT "login_identifiers_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

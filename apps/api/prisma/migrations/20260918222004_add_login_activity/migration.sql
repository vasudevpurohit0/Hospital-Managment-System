-- CreateTable
CREATE TABLE "login_activity" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "identifier" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_activity_identifier_created_at_idx" ON "login_activity"("identifier", "created_at");

-- AddForeignKey
ALTER TABLE "login_activity" ADD CONSTRAINT "login_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


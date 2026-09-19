-- CreateTable
CREATE TABLE "activation_tokens" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activation_tokens_token_hash_key" ON "activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "activation_tokens_identifier_idx" ON "activation_tokens"("identifier");

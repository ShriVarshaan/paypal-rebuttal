-- Day 16: onboarding state and encrypted merchant connections (additive).
ALTER TABLE "public"."Merchant" ADD COLUMN "onboardedAt" TIMESTAMPTZ(3);

CREATE TABLE "public"."Connection" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'default',
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secretCiphertext" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "lastError" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Connection_merchantId_kind_key" ON "public"."Connection"("merchantId", "kind");

ALTER TABLE "public"."Connection" ADD CONSTRAINT "Connection_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "public"."Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

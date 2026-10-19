-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "store";

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- The runtime remains single-merchant. This row must exist before the
-- backfilled foreign keys are made non-null so workers can create cases
-- without running the demo seed.
INSERT INTO "Merchant" ("id", "name", "defaultCurrency", "createdAt", "updatedAt")
VALUES ('default', 'Fern & Field Goods', 'USD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Add the merchant columns in upgrade-safe stages, then backfill existing rows.
ALTER TABLE "Case" ADD COLUMN "merchantId" TEXT;
ALTER TABLE "Policy" ADD COLUMN "merchantId" TEXT;

UPDATE "Case" SET "merchantId" = 'default' WHERE "merchantId" IS NULL;
UPDATE "Policy" SET "merchantId" = 'default' WHERE "merchantId" IS NULL;

ALTER TABLE "Case"
  ALTER COLUMN "merchantId" SET DEFAULT 'default',
  ALTER COLUMN "merchantId" SET NOT NULL;

ALTER TABLE "Policy"
  ALTER COLUMN "merchantId" SET DEFAULT 'default',
  ALTER COLUMN "merchantId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "modelId" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."ListingSnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "assets" JSONB NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL,
    "rendererVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "priorOrders" INTEGER NOT NULL DEFAULT 0,
    "priorDisputes" INTEGER NOT NULL DEFAULT 0,
    "knownIps" JSONB NOT NULL,
    "knownDevices" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Order" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "invoiceNumber" TEXT,
    "paypalCaptureId" TEXT,
    "paypalOrderId" TEXT,
    "status" TEXT NOT NULL,
    "placedAt" TIMESTAMPTZ(3) NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "digital" BOOLEAN NOT NULL DEFAULT false,
    "checkoutIp" TEXT,
    "checkoutDeviceId" TEXT,
    "avs" TEXT,
    "cvv" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "listingSnapshotId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "digital" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "history" JSONB NOT NULL,
    "shippedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."MessageThread" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."DownloadEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "deviceId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paypalRefundId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "refundedAt" TIMESTAMPTZ(3) NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store"."Subscription" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "chargedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "termsUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_caseId_sentAt_idx" ON "Message"("caseId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_caseId_source_dedupeKey_key" ON "Message"("caseId", "source", "dedupeKey");

-- CreateIndex
CREATE INDEX "EvalRun_datasetId_strategyId_createdAt_idx" ON "EvalRun"("datasetId", "strategyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "store"."Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "store"."Product"("sku");

-- CreateIndex
CREATE INDEX "ListingSnapshot_productId_capturedAt_idx" ON "store"."ListingSnapshot"("productId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingSnapshot_productId_revision_key" ON "store"."ListingSnapshot"("productId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "store"."Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "store"."Order"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalCaptureId_key" ON "store"."Order"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalOrderId_key" ON "store"."Order"("paypalOrderId");

-- CreateIndex
CREATE INDEX "Order_customerId_placedAt_idx" ON "store"."Order"("customerId", "placedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "store"."OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_listingSnapshotId_idx" ON "store"."OrderItem"("productId", "listingSnapshotId");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "store"."Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_carrier_trackingNumber_key" ON "store"."Shipment"("carrier", "trackingNumber");

-- CreateIndex
CREATE INDEX "MessageThread_orderId_createdAt_idx" ON "store"."MessageThread"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_threadId_sentAt_idx" ON "store"."Message"("threadId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_threadId_dedupeKey_key" ON "store"."Message"("threadId", "dedupeKey");

-- CreateIndex
CREATE INDEX "DownloadEvent_orderId_occurredAt_idx" ON "store"."DownloadEvent"("orderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_paypalRefundId_key" ON "store"."Refund"("paypalRefundId");

-- CreateIndex
CREATE INDEX "Refund_orderId_refundedAt_idx" ON "store"."Refund"("orderId", "refundedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orderId_key" ON "store"."Subscription"("orderId");

-- CreateIndex
CREATE INDEX "Case_merchantId_state_idx" ON "Case"("merchantId", "state");

-- CreateIndex
CREATE INDEX "Policy_merchantId_idx" ON "Policy"("merchantId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."ListingSnapshot" ADD CONSTRAINT "ListingSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "store"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "store"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."OrderItem" ADD CONSTRAINT "OrderItem_listingSnapshotId_fkey" FOREIGN KEY ("listingSnapshotId") REFERENCES "store"."ListingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."MessageThread" ADD CONSTRAINT "MessageThread_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "store"."MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."DownloadEvent" ADD CONSTRAINT "DownloadEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."DownloadEvent" ADD CONSTRAINT "DownloadEvent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "store"."OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store"."Subscription" ADD CONSTRAINT "Subscription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CaseState" AS ENUM ('NEW', 'GATHERING', 'TRIAGED', 'AWAITING_APPROVAL', 'FILING', 'FILED', 'WAITING_PAYPAL', 'OFFER_PENDING', 'WON', 'LOST', 'REFUNDED', 'APPEAL_DRAFTED');

-- CreateEnum
CREATE TYPE "DecisionOption" AS ENUM ('FIGHT', 'OFFER', 'ACCEPT');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'AUTO_APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('PROVIDE_EVIDENCE', 'MAKE_OFFER', 'ACCEPT_CLAIM', 'SEND_MESSAGE', 'ACKNOWLEDGE_RETURN_ITEM', 'APPEAL', 'PROVIDE_SUPPORTING_INFO', 'REFUND');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PackStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SlaKind" AS ENUM ('REMIND_72H', 'REMIND_24H', 'REMIND_6H', 'FORCE_DECISION');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'FIRED');

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "paypalDisputeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "disputeState" TEXT,
    "stage" TEXT NOT NULL,
    "channel" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sellerResponseDueAt" TIMESTAMPTZ(3),
    "buyerResponseDueAt" TIMESTAMPTZ(3),
    "state" "CaseState" NOT NULL DEFAULT 'NEW',
    "outcomeCode" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "sellerTransactionId" TEXT,
    "disputedTransactions" JSONB NOT NULL,
    "messages" JSONB NOT NULL,
    "allowedResponseOptions" JSONB,
    "transactionContext" JSONB,
    "raw" JSONB NOT NULL,
    "paypalCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "paypalUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "paypalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT,
    "verified" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "filePath" TEXT,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePack" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "decisionId" TEXT,
    "status" "PackStatus" NOT NULL DEFAULT 'PENDING',
    "files" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EvidencePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "option" "DecisionOption" NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "pWin" DOUBLE PRECISION,
    "evFight" DOUBLE PRECISION,
    "evOffer" DOUBLE PRECISION,
    "evAccept" DOUBLE PRECISION,
    "offerAmountCents" INTEGER,
    "offerType" TEXT,
    "note" TEXT NOT NULL,
    "rationale" TEXT,
    "reason" TEXT,
    "modelVersion" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "decisionId" TEXT,
    "kind" "ActionKind" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "request" JSONB,
    "response" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "SlaKind" NOT NULL,
    "jobId" TEXT NOT NULL,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SlaStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Case_paypalDisputeId_key" ON "Case"("paypalDisputeId");

-- CreateIndex
CREATE INDEX "Case_state_idx" ON "Case"("state");

-- CreateIndex
CREATE INDEX "Case_sellerResponseDueAt_idx" ON "Case"("sellerResponseDueAt");

-- CreateIndex
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_paypalEventId_key" ON "WebhookEvent"("paypalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_caseId_source_dedupeKey_key" ON "EvidenceItem"("caseId", "source", "dedupeKey");

-- CreateIndex
CREATE INDEX "EvidencePack_decisionId_idx" ON "EvidencePack"("decisionId");

-- CreateIndex
CREATE INDEX "Decision_caseId_idx" ON "Decision"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Action_idempotencyKey_key" ON "Action"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Action_caseId_kind_idx" ON "Action"("caseId", "kind");

-- CreateIndex
CREATE INDEX "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "SlaJob_caseId_status_idx" ON "SlaJob"("caseId", "status");

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePack" ADD CONSTRAINT "EvidencePack_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePack" ADD CONSTRAINT "EvidencePack_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaJob" ADD CONSTRAINT "SlaJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A Case never gets two successful write actions of the same kind (SEND_MESSAGE may repeat).
-- Prisma can't express partial indexes, so it lives here.
CREATE UNIQUE INDEX "Action_one_success_per_case_kind" ON "Action"("caseId", "kind")
  WHERE "status" = 'SUCCEEDED' AND "kind" <> 'SEND_MESSAGE';

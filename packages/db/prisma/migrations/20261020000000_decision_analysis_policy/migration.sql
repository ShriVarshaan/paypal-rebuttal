-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "analysis" JSONB,
ADD COLUMN     "narrative" JSONB;

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "config" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "decisionId" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_agent_createdAt_idx" ON "AgentRun"("agent", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_caseId_idx" ON "AgentRun"("caseId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

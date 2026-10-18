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

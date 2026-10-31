-- Day 9: evidence pack preview, size and exhibit index (additive).
ALTER TABLE "public"."EvidencePack"
  ADD COLUMN "previewPath" TEXT,
  ADD COLUMN "totalBytes" INTEGER,
  ADD COLUMN "exhibits" JSONB,
  ADD COLUMN "error" TEXT;

ALTER TYPE "public"."PackStatus" ADD VALUE 'SUPERSEDED';

import { readFile } from "node:fs/promises";
import type { LlmClient } from "@rebuttal/agent";
import { fromRepoRoot, type EvidenceSource } from "@rebuttal/connectors";
import type { Db } from "@rebuttal/db";
import { safeDefault } from "@rebuttal/decision";
import type { PdfEngine } from "@rebuttal/evidence";
import type { Logger, PayPalClient } from "@rebuttal/paypal";
import type { JobQueue } from "./queues.js";

/** Everything a job touches, injected so tests can swap any part. */
export interface Deps {
  db: Db;
  paypal: PayPalClient;
  queue: JobQueue;
  log: Logger;
  sources: EvidenceSource[];
  safeDefault: typeof safeDefault;
  /** Claude for the triage/narrative/appeal agents; null = deterministic templates only. */
  llm: LlmClient | null;
  now: () => Date;
  readFile: (path: string) => Promise<Uint8Array>;
  /** Opens a browser for the PDF pack job; null = packs are not built (FIGHT files at T-2h). */
  pdfEngine: (() => Promise<PdfEngine>) | null;
  /** Root for evidence files and packs (storage/evidence by default). */
  evidenceStorageDir: string;
}

export function defaultDeps(
  parts: Pick<Deps, "db" | "paypal" | "queue" | "log" | "sources"> & Partial<Deps>,
): Deps {
  return {
    safeDefault,
    llm: null,
    now: () => new Date(),
    readFile: (p) => readFile(p),
    pdfEngine: null,
    evidenceStorageDir: fromRepoRoot(process.env["EVIDENCE_STORAGE_DIR"] ?? "storage/evidence"),
    ...parts,
  };
}

/** A job failure that retrying cannot fix. Handlers record it and complete the job. */
export class PermanentJobError extends Error {
  override readonly name = "PermanentJobError";
}

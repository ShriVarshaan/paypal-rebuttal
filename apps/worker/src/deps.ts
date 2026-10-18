import { readFile } from "node:fs/promises";
import type { EvidenceSource } from "@rebuttal/connectors";
import type { Db } from "@rebuttal/db";
import { safeDefault } from "@rebuttal/decision";
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
  now: () => Date;
  readFile: (path: string) => Promise<Uint8Array>;
}

export function defaultDeps(
  parts: Pick<Deps, "db" | "paypal" | "queue" | "log" | "sources"> & Partial<Deps>,
): Deps {
  return { safeDefault, now: () => new Date(), readFile: (p) => readFile(p), ...parts };
}

/** A job failure that retrying cannot fix. Handlers record it and complete the job. */
export class PermanentJobError extends Error {
  override readonly name = "PermanentJobError";
}

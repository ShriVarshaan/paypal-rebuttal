import { z } from "zod";
import { EvidenceType } from "./paypal-enums.js";

/** One piece of evidence gathered by a connector. `dedupeKey` makes re-gathering idempotent. */
export const EvidenceItem = z.object({
  source: z.string(),
  type: EvidenceType,
  title: z.string(),
  dedupeKey: z.string(),
  data: z.record(z.string(), z.unknown()),
  filePath: z.string().optional(),
  capturedAt: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

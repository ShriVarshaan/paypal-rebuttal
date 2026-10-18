import { z } from "zod";
import { ActionKind, ActionStatus } from "./action.js";
import { DecisionAnalysis, Narrative } from "./analysis.js";
import { DecisionOption, DecisionStatus } from "./decision.js";
import { OfferType } from "./paypal-enums.js";

/**
 * Stored records as the api returns them (Prisma rows, dates as ISO strings). The web app
 * (C) parses responses with these; JSON columns are typed via the analysis schemas.
 */
const Iso = z.union([z.string(), z.date().transform((d) => d.toISOString())]);

export const DecisionRecord = z.object({
  id: z.string(),
  caseId: z.string(),
  option: DecisionOption,
  status: DecisionStatus,
  pWin: z.number().nullable(),
  /** EVs in minor units of the case currency, against refunding in full. */
  evFight: z.number().nullable(),
  evOffer: z.number().nullable(),
  evAccept: z.number().nullable(),
  offerAmountCents: z.number().int().nullable(),
  offerType: OfferType.nullable(),
  /** The note sent to PayPal with the action (≤ 2000 chars). */
  note: z.string(),
  rationale: z.string().nullable(),
  /** "DEADLINE" for the deadline override; "SUPERSEDED" on replaced proposals. */
  reason: z.string().nullable(),
  modelVersion: z.string().nullable(),
  analysis: DecisionAnalysis.nullable(),
  narrative: Narrative.nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: Iso.nullable(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

export const ActionRecord = z.object({
  id: z.string(),
  caseId: z.string(),
  decisionId: z.string().nullable(),
  kind: ActionKind,
  endpoint: z.string(),
  idempotencyKey: z.string(),
  status: ActionStatus,
  attempts: z.number().int(),
  request: z.unknown().nullable(),
  response: z.unknown().nullable(),
  error: z.unknown().nullable(),
  createdAt: Iso,
  completedAt: Iso.nullable(),
});
export type ActionRecord = z.infer<typeof ActionRecord>;

export const CaseEventRecord = z.object({
  id: z.string(),
  caseId: z.string(),
  /** A CaseEventType; kept as a string so older rows with retired types still parse. */
  type: z.string(),
  payload: z.unknown(),
  createdAt: Iso,
});
export type CaseEventRecord = z.infer<typeof CaseEventRecord>;

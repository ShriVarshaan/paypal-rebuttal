import { DecisionOption } from "@rebuttal/core";
import { z } from "zod";

/**
 * One labeled synthetic dispute (role doc Day 4). `dispute` + `evidence` are what the system
 * sees; `label` is the human (or generator) call; `world` is the simulated buyer and PayPal
 * the dollar figures are scored against. Stored as packages/eval/cases/<id>.json.
 */
export const EvalEvidence = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  title: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type EvalEvidence = z.infer<typeof EvalEvidence>;

export const EvalCase = z.object({
  id: z.string(),
  title: z.string(),
  dispute: z.object({
    reason: z.string(),
    stage: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.string().default("USD"),
    paidAt: z.string(),
    openedAt: z.string(),
    dueAt: z.string(),
    allowedResponseOptions: z.unknown().nullable(),
    messages: z.array(
      z.object({ postedBy: z.string(), postedAt: z.string().nullable(), content: z.string() }),
    ),
    items: z.array(z.string()),
  }),
  /** The seller's records, in the connectors' EvidenceItem shape. */
  evidence: z.array(EvalEvidence),
  label: z.object({
    bestOption: DecisionOption,
    /** Every option a reasonable seller could defend; always includes bestOption. */
    acceptableOptions: z.array(DecisionOption).min(1),
    expectedOutcomeIfFight: z.enum(["WIN", "LOSE"]),
    notes: z.string().min(1),
    labeler: z.string(),
  }),
  /** The simulated world: never shown to the system under test. */
  world: z.object({
    /** Probability that fighting wins (generated cases draw expectedOutcomeIfFight from it). */
    pWin: z.number().min(0).max(1),
    /** Smallest partial-refund ratio the buyer accepts; above 1 means never. */
    buyerAcceptRatio: z.number().min(0),
    acceptsReturn: z.boolean(),
  }),
  meta: z.object({
    origin: z.enum(["hand", "generated", "injection"]),
    author: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    tags: z.array(z.string()),
  }),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const wins = (c: EvalCase): boolean => c.label.expectedOutcomeIfFight === "WIN";

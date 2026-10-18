import { DecisionOption } from "@rebuttal/core";
import { z } from "zod";

/**
 * One labeled synthetic dispute. `dispute` + `evidence` are what the system sees;
 * `truth` is the hidden world the eval scores against; `label` is the human call.
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
  origin: z.enum(["hand", "generated"]),
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
  evidence: z.array(EvalEvidence),
  truth: z.object({
    /** The world's probability that fighting wins. */
    pWin: z.number().min(0).max(1),
    /** Whether a fight actually wins in this world (drawn from pWin). */
    wins: z.boolean(),
    /** Smallest partial-refund ratio the buyer accepts; above 1 means never. */
    buyerAcceptRatio: z.number().min(0),
    /** Whether the buyer takes a full refund with return. */
    acceptsReturn: z.boolean(),
  }),
  label: z.object({
    option: DecisionOption,
    rationale: z.string(),
    /** Who labeled it. Draft labels await the team's independent labeling (plan Day 12). */
    labeler: z.string(),
  }),
});
export type EvalCase = z.infer<typeof EvalCase>;

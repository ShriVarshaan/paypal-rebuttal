import { draftBuyerMessage } from "@rebuttal/agent";
import { DecisionOption, OfferType, Policy, policyFrom } from "@rebuttal/core";
import { NOTE_MAX } from "@rebuttal/decision";
import { agentCase, POLICY_ID, QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { tokenMatches } from "./cases.js";

/**
 * B's routes for the web app: merchant policy (settings page), re-running triage, editing
 * or overriding a proposed decision, and drafting a buyer message. Same bearer token as /cases.
 */
export function intelligenceRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.get("/policy", async () => {
      const row = await deps.db.policy.findUnique({ where: { id: POLICY_ID } });
      return { policy: policyFrom(row?.config), isDefault: !row, updatedAt: row?.updatedAt ?? null };
    });

    app.put("/policy", async (req, reply) => {
      const body = z
        .object({ policy: z.unknown(), updatedBy: z.string().max(100).optional() })
        .safeParse(req.body);
      const parsed = body.success ? Policy.safeParse(body.data.policy ?? {}) : null;
      if (!body.success || !parsed?.success)
        return reply
          .code(400)
          .send({ error: "invalid policy", issues: parsed?.error?.issues ?? body.error?.issues });
      const row = await deps.db.policy.upsert({
        where: { id: POLICY_ID },
        create: { id: POLICY_ID, config: parsed.data, updatedBy: body.data.updatedBy ?? null },
        update: { config: parsed.data, updatedBy: body.data.updatedBy ?? null },
      });
      return { policy: parsed.data, isDefault: false, updatedAt: row.updatedAt };
    });

    app.post("/cases/:id/triage", async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      if (!(await deps.db.case.findUnique({ where: { id }, select: { id: true } })))
        return reply.code(404).send({ error: "not found" });
      await deps.queue.send(QUEUES.caseTriage, { caseId: id }, { singletonKey: id });
      return reply.code(202).send({ queued: true });
    });

    /** Approve / Edit / Override (plan Day 10): change a PROPOSED decision before it's approved. */
    app.patch("/decisions/:id", async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({
          editedBy: z.string().min(1).max(100).default("seller"),
          note: z.string().min(1).max(NOTE_MAX).optional(),
          option: DecisionOption.optional(),
          offerType: OfferType.optional(),
          offerAmountCents: z.number().int().positive().optional(),
        })
        .safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid edit", issues: body.error.issues });
      const d = await deps.db.decision.findUnique({ where: { id }, include: { case: true } });
      if (!d) return reply.code(404).send({ error: "not found" });
      if (d.status !== "PROPOSED") return reply.code(409).send({ error: `decision is ${d.status}` });

      const e = body.data;
      const option = e.option ?? d.option;
      const offerType = option === "OFFER" ? (e.offerType ?? d.offerType ?? "REFUND") : null;
      const offerAmountCents =
        option === "OFFER" && offerType !== "REPLACEMENT_WITHOUT_REFUND"
          ? (e.offerAmountCents ?? d.offerAmountCents)
          : null;
      if (option === "OFFER" && offerType !== "REPLACEMENT_WITHOUT_REFUND") {
        if (offerAmountCents == null)
          return reply.code(400).send({ error: "an offer needs offerAmountCents" });
        if (offerAmountCents > d.case.amountCents)
          return reply.code(400).send({ error: "offer exceeds the disputed amount" });
      }
      if (option !== d.option && !e.note)
        return reply.code(400).send({ error: "changing the option needs a new note for PayPal" });

      const updated = await deps.db.$transaction(async (tx) => {
        const u = await tx.decision.update({
          where: { id },
          data: { option, offerType, offerAmountCents, ...(e.note ? { note: e.note } : {}) },
        });
        await tx.caseEvent.create({
          data: {
            caseId: d.caseId,
            type: "DECISION_EDITED",
            payload: {
              decisionId: id,
              editedBy: e.editedBy,
              from: { option: d.option, offerType: d.offerType, offerAmountCents: d.offerAmountCents },
              to: { option, offerType, offerAmountCents },
              override: option !== d.option,
              noteChanged: !!e.note,
            },
          },
        });
        return u;
      });
      return updated;
    });

    app.post("/cases/:id/buyer-message", async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const row = await deps.db.case.findUnique({
        where: { id },
        include: {
          decisions: { where: { status: { not: "REJECTED" } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (!row) return reply.code(404).send({ error: "not found" });
      const d = row.decisions[0];
      const offer =
        d?.option === "OFFER" && d.offerType
          ? {
              type: d.offerType as OfferType,
              amount: { cents: d.offerAmountCents ?? 0, currency: row.currency },
            }
          : null;
      const out = await draftBuyerMessage(deps.llm ?? null, {
        c: agentCase(row),
        option: d?.option ?? "FIGHT",
        offer,
      });
      return { ...out.draft, decisionId: d?.id ?? null, error: out.error, usage: out.usage };
    });
  };
}

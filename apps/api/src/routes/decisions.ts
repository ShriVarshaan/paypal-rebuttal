import { narrativeToNote } from "@rebuttal/agent";
import { DecisionOption, Narrative, NarrativeClaim, OfferType } from "@rebuttal/core";
import { NOTE_MAX } from "@rebuttal/decision";
import type { Prisma } from "@rebuttal/db";
import { QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { citableExhibits, editDecision } from "../decision-edits.js";
import { sendStoredFile } from "../files.js";
import { tokenMatches } from "./cases.js";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const Id = z.object({ id: z.string().min(1) });
const Actor = z.string().trim().min(1).max(100).default("seller");
const Reason = z.string().trim().min(3, "give a reason of at least 3 characters").max(500);

/**
 * C's decision workflow (Days 10–11): approve, reject and override with an audit trail, edit
 * the narrative (which rebuilds the PDF), and serve the pack for the in-browser preview.
 * Nothing here calls PayPal: approval enqueues the executor, which files.
 */
export function decisionRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.post("/decisions/:id/approve", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const body = z.object({ approvedBy: Actor }).safeParse(req.body ?? {});
      if (!body.success)
        return reply.code(400).send({ error: "invalid approval", issues: body.error.issues });
      const now = new Date();
      const updated = await deps.db.decision.updateMany({
        where: { id, status: "PROPOSED" },
        data: { status: "APPROVED", approvedBy: body.data.approvedBy, approvedAt: now },
      });
      if (updated.count === 0) {
        const exists = await deps.db.decision.findUnique({ where: { id }, select: { status: true } });
        return reply
          .code(exists ? 409 : 404)
          .send({ error: exists ? `decision is ${exists.status}` : "not found" });
      }
      const decision = await deps.db.decision.findUniqueOrThrow({
        where: { id },
        include: { packs: { where: { status: { in: ["PENDING", "READY"] } }, take: 1 } },
      });
      await deps.db.caseEvent.create({
        data: {
          caseId: decision.caseId,
          type: "DECISION_APPROVED",
          payload: json({ decisionId: id, by: body.data.approvedBy, option: decision.option }),
        },
      });
      // A FIGHT without a pack (e.g. built before the pack job existed) gets one now;
      // the executor waits for it, or files without it at T-2h.
      if (decision.option === "FIGHT" && decision.packs.length === 0)
        await deps.queue.send(QUEUES.packBuild, { decisionId: id }, { singletonKey: id });
      await deps.queue.send(QUEUES.actionExecute, { decisionId: id }, { singletonKey: id });
      const { packs: _packs, ...rest } = decision;
      return rest;
    });

    app.post("/decisions/:id/reject", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const body = z.object({ by: Actor, reason: Reason }).safeParse(req.body ?? {});
      if (!body.success)
        return reply.code(400).send({ error: "a rejection needs a reason", issues: body.error.issues });
      const d = await deps.db.decision.findUnique({ where: { id } });
      if (!d) return reply.code(404).send({ error: "not found" });
      if (d.status !== "PROPOSED") return reply.code(409).send({ error: `decision is ${d.status}` });
      const [updated] = await deps.db.$transaction([
        deps.db.decision.update({
          where: { id },
          data: { status: "REJECTED", reason: "REJECTED_BY_SELLER" },
        }),
        deps.db.evidencePack.updateMany({
          where: { decisionId: id, status: { in: ["PENDING", "READY"] } },
          data: { status: "SUPERSEDED" },
        }),
        deps.db.caseEvent.create({
          data: {
            caseId: d.caseId,
            type: "DECISION_REJECTED",
            payload: json({ decisionId: id, by: body.data.by, reason: body.data.reason, option: d.option }),
          },
        }),
      ]);
      return updated;
    });

    app.post("/decisions/:id/override", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const body = z
        .object({
          by: Actor,
          reason: Reason,
          option: DecisionOption,
          offerType: OfferType.optional(),
          offerAmountCents: z.number().int().positive().optional(),
          note: z.string().trim().min(1).max(NOTE_MAX).optional(),
        })
        .safeParse(req.body ?? {});
      if (!body.success)
        return reply.code(400).send({ error: "invalid override", issues: body.error.issues });
      const { by, reason, ...edit } = body.data;
      const r = await editDecision(deps, id, { ...edit, by, overrideReason: reason, defaultNote: true });
      return r.ok ? r.decision : reply.code(r.status).send({ error: r.error });
    });

    /** Seller edits B's statement. Every claim must still cite an exhibit of this decision. */
    app.put("/decisions/:id/narrative", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const body = z
        .object({
          by: Actor,
          headline: z.string().trim().min(1).max(200),
          claims: z.array(NarrativeClaim).min(1).max(12),
        })
        .safeParse(req.body ?? {});
      if (!body.success)
        return reply
          .code(400)
          .send({ error: "every claim needs text and at least one exhibit", issues: body.error.issues });
      const d = await deps.db.decision.findUnique({
        where: { id },
        include: { case: { include: { evidence: true } } },
      });
      if (!d) return reply.code(404).send({ error: "not found" });
      if (d.status !== "PROPOSED") return reply.code(409).send({ error: `decision is ${d.status}` });
      if (d.option !== "FIGHT")
        return reply.code(409).send({ error: "only FIGHT decisions have a narrative" });
      const allowed = citableExhibits(d, d.case.evidence);
      const unknown = [...new Set(body.data.claims.flatMap((c) => c.exhibits))].filter(
        (x) => !allowed.has(x),
      );
      if (unknown.length) return reply.code(400).send({ error: `unknown exhibit(s): ${unknown.join(", ")}` });

      const previous = Narrative.safeParse(d.narrative);
      const narrative = Narrative.parse({
        headline: body.data.headline,
        claims: body.data.claims.map((c) => ({ text: c.text.trim(), exhibits: [...new Set(c.exhibits)] })),
        source: previous.success ? previous.data.source : "template",
        rejectedClaims: 0,
        needsReview: false,
        notesByType: previous.success ? previous.data.notesByType : {},
      });
      const note = narrativeToNote(narrative);
      const updated = await deps.db.$transaction(async (tx) => {
        const u = await tx.decision.update({ where: { id }, data: { narrative: json(narrative), note } });
        await tx.caseEvent.create({
          data: {
            caseId: d.caseId,
            type: "NARRATIVE_EDITED",
            payload: json({ decisionId: id, by: body.data.by, claims: narrative.claims.length }),
          },
        });
        return u;
      });
      await deps.queue.send(QUEUES.packBuild, { decisionId: id }, { singletonKey: id });
      return updated;
    });

    app.post("/decisions/:id/pack", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const d = await deps.db.decision.findUnique({ where: { id }, select: { option: true, status: true } });
      if (!d) return reply.code(404).send({ error: "not found" });
      if (d.option !== "FIGHT") return reply.code(409).send({ error: "only FIGHT decisions have a pack" });
      if (d.status === "EXECUTED" || d.status === "REJECTED")
        return reply.code(409).send({ error: `decision is ${d.status}` });
      await deps.queue.send(QUEUES.packBuild, { decisionId: id }, { singletonKey: id });
      return reply.code(202).send({ queued: true });
    });

    /** The pack PDF: `preview` (cover + every exhibit) or one submission file by name. */
    app.get("/packs/:id/file", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const q = z.object({ name: z.string().max(200).default("preview") }).safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: "invalid file name" });
      const pack = await deps.db.evidencePack.findUnique({ where: { id }, include: { case: true } });
      if (!pack) return reply.code(404).send({ error: "not found" });
      const files = Array.isArray(pack.files) ? (pack.files as { name?: string; path?: string }[]) : [];
      const path =
        q.data.name === "preview"
          ? pack.previewPath
          : (files.find((f) => f.name === q.data.name)?.path ?? null);
      if (!path) return reply.code(404).send({ error: "pack file unavailable" });
      const downloadName =
        q.data.name === "preview" ? `evidence-pack-${pack.case.paypalDisputeId}.pdf` : q.data.name;
      return sendStoredFile(reply, deps.config.evidenceStorageDir, path, { downloadName });
    });

    /**
     * Send a message to the buyer (Day 12). `requestId` comes from the composer, one per
     * draft, so a double submit or a retry maps to the same Action and PayPal-Request-Id.
     */
    app.post("/cases/:id/messages", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const body = z
        .object({
          by: Actor,
          message: z.string().trim().min(1).max(2000),
          requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
        })
        .safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid message", issues: body.error.issues });
      const c = await deps.db.case.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!c) return reply.code(404).send({ error: "not found" });
      if (c.status === "RESOLVED") return reply.code(409).send({ error: "the dispute is resolved" });
      const key = `${id}:message:${body.data.requestId}`;
      const action = await deps.db.action.upsert({
        where: { idempotencyKey: key },
        create: {
          caseId: id,
          kind: "SEND_MESSAGE",
          endpoint: "POST /v1/customer/disputes/{id}/send-message",
          idempotencyKey: key,
          request: json({ message: body.data.message, by: body.data.by }),
        },
        update: {},
      });
      await deps.queue.send(QUEUES.messageSend, { actionId: action.id }, { singletonKey: action.id });
      return reply.code(202).send({ actionId: action.id, status: action.status });
    });

    app.post("/notifications/:id/read", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const r = await deps.db.notification.updateMany({
        where: { id, readAt: null },
        data: { readAt: new Date() },
      });
      return reply.code(r.count ? 200 : 404).send({ read: r.count });
    });

    app.post("/notifications/read-all", async () => {
      const r = await deps.db.notification.updateMany({
        where: { readAt: null },
        data: { readAt: new Date() },
      });
      return { read: r.count };
    });
  };
}
